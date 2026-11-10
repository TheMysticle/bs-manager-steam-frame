import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "fs-extra";
import log from "electron-log";
import { Observable, lastValueFrom, tap } from "rxjs";
import { BSVersion } from "shared/bs-version.interface";
import {
    BS_ARM64_FALLBACK_VERSIONS,
    BS_ARM64_MANIFEST_ASSET,
    BS_ARM64_REPOSITORY,
    BsArm64Error,
    BsArm64InstallOptions,
    BsArm64Manifest,
    BsArm64Progress,
    BsArm64Status,
    BsArm64Unsupported,
} from "shared/models/bs-arm64/bs-arm64.model";
import { CustomError } from "shared/models/exceptions/custom-error.class";
import { tryit } from "shared/helpers/error.helpers";
import { BsmShellLog, bsmSpawn } from "main/helpers/os.helpers";
import { IS_FLATPAK } from "main/constants";
import { BS_ARM64_STATE_DIR, isBsArm64Installed, isBsArm64ModsDisabled } from "main/helpers/bs-arm64.helpers";
import { BSLocalVersionService } from "./bs-local-version.service";
import { InstallationLocationService } from "./installation-location.service";
import { LinuxService } from "./linux.service";
import { RequestService } from "./request.service";

// Written by BSManager next to it: which release (and where it's unpacked) patched the instance
const RELEASE_FILE = "bsm-release.json";

export type GithubRelease = {
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    assets: { name: string; browser_download_url: string }[];
};

type InstalledRelease = { tag: string; dir: string | undefined };

export type ReleaseAsset = { release: GithubRelease; asset: GithubRelease["assets"][number] };

// What the newest release offers for a Proton build, and which game versions it supports
export type ReleaseInfo = {
    protonBuild: string | undefined;
    match?: ReleaseAsset;
    manifest?: BsArm64Manifest;
    supportedVersions: string[];
};

// GitHub allows 60 unauthenticated API requests an hour; the status is asked for on every version view
const RELEASE_INFO_TTL_MS = 10 * 60 * 1000;

// Proton's version file says e.g. "proton-11.0-2c-arm64" for the tag "proton-11.0-2c"
function isBuildOfProtonTag(protonBuild: string, protonTag: string): boolean {
    return protonBuild === protonTag || protonBuild.startsWith(`${protonTag}-`);
}

/** Newest published release (GitHub lists them newest first); its manifest, if any, is the one to read. */
export function newestBsArm64Release(releases: GithubRelease[]): GithubRelease | undefined {
    return releases.find(release => !release.draft && !release.prerelease);
}

/**
 * The asset of a release to install for the given Proton build: the one its manifest names.
 * A release can work with several Proton versions (e.g. 11.0-2c and 11.0-2e) from one tarball.
 */
export function findBsArm64ReleaseAsset(release: GithubRelease, manifest: BsArm64Manifest, protonBuild: string | undefined): ReleaseAsset | undefined {
    if (!protonBuild) {
        return undefined;
    }
    const entry = Object.entries(manifest.protonVersions).find(([protonTag]) => isBuildOfProtonTag(protonBuild, protonTag))?.[1];
    const asset = entry && release.assets.find(a => a.name === entry.artifact);
    return asset ? { release, asset } : undefined;
}

/**
 * For releases without a manifest (this fork's v1.45.1-1.45.2 and older): the newest release
 * asset named bs-arm64-<tag>-<PROTON_TAG>.tar.gz for the given Proton build.
 */
export function findBsArm64ReleaseAssetByName(releases: GithubRelease[], protonBuild: string | undefined): ReleaseAsset | undefined {
    if (!protonBuild) {
        return undefined;
    }
    return releases
        .filter(release => !release.draft && !release.prerelease)
        .flatMap(release => release.assets.map(asset => ({ release, asset })))
        .find(({ release, asset }) => {
            const prefix = `bs-arm64-${release.tag_name}-`;
            if (!asset.name.startsWith(prefix) || !asset.name.endsWith(".tar.gz")) {
                return false;
            }
            return isBuildOfProtonTag(protonBuild, asset.name.slice(prefix.length, -".tar.gz".length));
        });
}

/**
 * What to install for a Proton build. With the newest release's manifest, that release decides
 * (its Proton map and tested game versions); without one, fall back to asset names and the
 * built-in version list.
 */
export function selectBsArm64Release(releases: GithubRelease[], manifest: BsArm64Manifest | undefined, protonBuild: string | undefined): ReleaseInfo {
    const newest = newestBsArm64Release(releases);
    if (newest && manifest) {
        return { protonBuild, manifest, match: findBsArm64ReleaseAsset(newest, manifest, protonBuild), supportedVersions: manifest.bsVersions };
    }
    return { protonBuild, match: findBsArm64ReleaseAssetByName(releases, protonBuild), supportedVersions: BS_ARM64_FALLBACK_VERSIONS };
}

/**
 * Installs the native ARM64 runtime (bs-arm64, see BS_ARM64_REPOSITORY) into a Beat Saber
 * instance. The release matching the selected Proton build is downloaded, verified and
 * unpacked into BSManager's cache, and its bs-arm64.sh does the rest.
 */
export class BsArm64Service {
    private static instance: BsArm64Service;

    public static getInstance(): BsArm64Service {
        if (!BsArm64Service.instance) {
            BsArm64Service.instance = new BsArm64Service();
        }
        return BsArm64Service.instance;
    }

    private readonly linux = LinuxService.getInstance();
    private readonly localVersions = BSLocalVersionService.getInstance();
    private readonly installLocation = InstallationLocationService.getInstance();
    private readonly request = RequestService.getInstance();

    private releaseInfo?: { info: ReleaseInfo; time: number };

    private constructor() {}

    public async getStatus(version: BSVersion): Promise<BsArm64Status> {
        const versionPath = await this.localVersions.getVersionPath(version);
        const installed = isBsArm64Installed(versionPath);
        const status: BsArm64Status = {
            installed,
            mods: installed && !isBsArm64ModsDisabled(versionPath),
            protonVersion: this.linux.getProtonBuild("bs-arm64"),
        };

        if (installed) {
            status.installedProtonVersion = await this.readStateFile(versionPath, "proton-version");
            status.installedRelease = (await this.readInstalledRelease(versionPath))?.tag;
        }

        if (process.platform !== "linux" || process.arch !== "arm64") {
            status.unsupported = BsArm64Unsupported.NOT_LINUX_ARM64;
            return status;
        }
        if (!tryit(() => this.linux.isArm64Wine("bs-arm64")).result) {
            status.unsupported = BsArm64Unsupported.PROTON_NOT_ARM64;
            return status;
        }

        // Offline or GitHub unreachable: fall back to the built-in version list
        const info = await this.getReleaseInfo().catch((error): undefined => {
            log.warn("Could not get the bs-arm64 releases", error);
            return undefined;
        });
        if (info && !info.match) {
            status.unsupported = BsArm64Unsupported.NO_RELEASE;
            return status;
        }

        status.supportedVersions = info?.supportedVersions ?? BS_ARM64_FALLBACK_VERSIONS;
        if (!status.supportedVersions.includes(version.BSVersion)) {
            status.unsupported = BsArm64Unsupported.VERSION_NOT_SUPPORTED;
        }

        return status;
    }

    public install(version: BSVersion, options: BsArm64InstallOptions): Observable<BsArm64Progress> {
        return new Observable<BsArm64Progress>(obs => {
            (async () => {
                const versionPath = await this.localVersions.getVersionPath(version);
                const release = await this.prepareRelease(msg => obs.next(msg));
                const args = ["install", this.quote(versionPath), ...this.prefixArgs()];
                if (!options.mods) {
                    args.push("--no-mods");
                }
                await this.runInstaller(release.dir, args, msg => obs.next(msg));
                await fs.writeJson(path.join(versionPath, BS_ARM64_STATE_DIR, RELEASE_FILE), release);
            })().then(() => obs.complete(), err => obs.error(err));
        });
    }

    public uninstall(version: BSVersion): Observable<BsArm64Progress> {
        return new Observable<BsArm64Progress>(obs => {
            (async () => {
                const versionPath = await this.localVersions.getVersionPath(version);
                const installed = await this.readInstalledRelease(versionPath);
                const dir = installed?.dir && await fs.pathExists(path.join(installed.dir, "bs-arm64.sh"))
                    ? installed.dir
                    : (await this.prepareRelease(msg => obs.next(msg))).dir;
                await this.runInstaller(dir, ["uninstall", this.quote(versionPath), ...this.prefixArgs()], msg => obs.next(msg));
            })().then(() => obs.complete(), err => obs.error(err));
        });
    }

    /**
     * Installing or updating BSIPA puts its x64 winhttp.dll and MonoMod.Core.dll back.
     * Run the installer again so the instance gets the ARM64 ones.
     */
    public async reapplyAfterBsipaChange(version: BSVersion): Promise<void> {
        const versionPath = await this.localVersions.getVersionPath(version);
        if (!isBsArm64Installed(versionPath) || isBsArm64ModsDisabled(versionPath)) {
            return;
        }
        log.info("BSIPA changed in a native ARM64 instance, re-applying the ARM64 mod loader fixes");
        await lastValueFrom(this.install(version, { mods: true }), { defaultValue: undefined });
    }

    // === Release === //

    private releasesDir(): string {
        return path.join(this.installLocation.cachePath(), "bs-arm64");
    }

    /** The newest release's asset for the selected Proton build and what it supports. Cached for a while. */
    private async getReleaseInfo(): Promise<ReleaseInfo> {
        const protonBuild = this.linux.getProtonBuild("bs-arm64");
        const cached = this.releaseInfo;
        if (cached && cached.info.protonBuild === protonBuild && Date.now() - cached.time < RELEASE_INFO_TTL_MS) {
            return cached.info;
        }

        const { data: releases } = await this.request.getJSON<GithubRelease[]>(
            `https://api.github.com/repos/${BS_ARM64_REPOSITORY}/releases`
        );
        const manifestAsset = newestBsArm64Release(releases)?.assets.find(asset => asset.name === BS_ARM64_MANIFEST_ASSET);
        const manifest = manifestAsset ? await this.downloadManifest(manifestAsset.browser_download_url) : undefined;
        const info = selectBsArm64Release(releases, manifest, protonBuild);

        this.releaseInfo = { info, time: Date.now() };
        return info;
    }

    private async downloadManifest(url: string): Promise<BsArm64Manifest> {
        await fs.ensureDir(this.releasesDir());
        const file = path.join(this.releasesDir(), `manifest-${Date.now()}.json`);
        try {
            await lastValueFrom(this.request.downloadFile(url, file));
            const manifest: BsArm64Manifest = await fs.readJson(file);
            if (!Array.isArray(manifest?.bsVersions) || !manifest.protonVersions || typeof manifest.protonVersions !== "object") {
                throw new Error(`Invalid ${BS_ARM64_MANIFEST_ASSET}`);
            }
            return manifest;
        } finally {
            await fs.remove(file);
        }
    }

    /** Newest release built for the selected Proton build, downloaded and unpacked. */
    private async prepareRelease(progress: (p: BsArm64Progress) => void): Promise<InstalledRelease> {
        this.releaseInfo = undefined;
        const { protonBuild, match } = await this.getReleaseInfo();

        if (!match) {
            throw new CustomError(`No bs-arm64 release for ${protonBuild}`, BsArm64Error.NO_MATCHING_RELEASE, protonBuild);
        }

        const { release, asset } = match;
        const name = asset.name.slice(0, -".tar.gz".length);
        const dir = path.join(this.releasesDir(), name);
        if (await fs.pathExists(path.join(dir, "bs-arm64.sh"))) {
            progress({ log: `Using ${name}` });
            return { tag: release.tag_name, dir };
        }

        await fs.ensureDir(this.releasesDir());
        const tarball = path.join(this.releasesDir(), asset.name);
        progress({ log: `Downloading ${asset.name}` });
        await lastValueFrom(this.request.downloadFile(asset.browser_download_url, tarball).pipe(
            tap(p => p.total && progress({ percent: Math.round((p.current / p.total) * 100) }))
        ));

        const checksumAsset = release.assets.find(a => a.name === `${asset.name}.sha256`);
        if (checksumAsset) {
            const expected = await this.downloadChecksum(checksumAsset.browser_download_url);
            const actual = await this.sha256(tarball);
            if (expected !== actual) {
                await fs.remove(tarball);
                throw new CustomError(`Checksum mismatch for ${asset.name}`, BsArm64Error.CHECKSUM_MISMATCH);
            }
            progress({ log: "Checksum OK" });
        }

        progress({ log: `Unpacking into ${this.releasesDir()}` });
        await this.run(`tar -xzf ${this.quote(tarball)} -C ${this.quote(this.releasesDir())}`, progress);
        await fs.remove(tarball);
        return { tag: release.tag_name, dir };
    }

    // "<sha256>  <file name>"
    private async downloadChecksum(url: string): Promise<string> {
        const file = path.join(this.releasesDir(), `checksum-${Date.now()}.txt`);
        await lastValueFrom(this.request.downloadFile(url, file));
        const text = await fs.readFile(file, "utf8");
        await fs.remove(file);
        return text.trim().split(/\s+/)[0];
    }

    private sha256(file: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash("sha256");
            createReadStream(file)
                .on("data", chunk => hash.update(chunk))
                .on("error", reject)
                .on("end", () => resolve(hash.digest("hex")));
        });
    }

    // === Installer === //

    private prefixArgs(): string[] {
        return ["--prefix", this.quote(this.linux.getCompatDataPath()), "--proton", this.quote(this.linux.getProtonFolder("bs-arm64"))];
    }

    private async runInstaller(dir: string, args: string[], progress: (p: BsArm64Progress) => void): Promise<void> {
        try {
            await this.run(`bash ${this.quote(path.join(dir, "bs-arm64.sh"))} ${args.join(" ")}`, progress);
        } catch (error) {
            throw CustomError.fromError(error as Error, BsArm64Error.INSTALLER_FAILED, (error as Error)?.message);
        }
    }

    private run(command: string, progress: (p: BsArm64Progress) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = bsmSpawn(command, {
                log: BsmShellLog.Command,
                flatpak: { host: IS_FLATPAK },
            });
            let lastError = "";
            const forward = (data: Buffer, isError: boolean) => {
                for (const line of data.toString().split("\n").map(l => l.trimEnd()).filter(Boolean)) {
                    if (isError) {
                        log.warn("bs-arm64:", line);
                        lastError = line;
                    } else {
                        log.info("bs-arm64:", line);
                    }
                    progress({ log: line });
                }
            };
            child.stdout?.on("data", d => forward(d, false));
            child.stderr?.on("data", d => forward(d, true));
            child.once("error", reject);
            child.once("close", code => (code === 0 ? resolve() : reject(new Error(lastError || `exit code ${code}`))));
        });
    }

    // === State === //

    private async readStateFile(versionPath: string, name: string): Promise<string | undefined> {
        const file = path.join(versionPath, BS_ARM64_STATE_DIR, name);
        return (await fs.pathExists(file)) ? (await fs.readFile(file, "utf8")).trim() : undefined;
    }

    // bsm-release.json is only written by our own install() below. When bs-arm64.sh was run
    // directly instead (e.g. by hand over SSH), that file never gets created, so fall back to
    // the tag the release tarball itself recorded (install/bs-arm64.sh copies it in as
    // "release") -- without this, the ARM64 tab shows "?" for an install it can plainly see
    // is there. There's no known download dir in that case; callers already handle a missing
    // dir by re-downloading the release when they need its files (e.g. to uninstall).
    private async readInstalledRelease(versionPath: string): Promise<InstalledRelease | undefined> {
        const fromBsm = await fs.readJson(path.join(versionPath, BS_ARM64_STATE_DIR, RELEASE_FILE)).catch((): undefined => undefined);
        if (fromBsm) {
            return fromBsm;
        }
        const tag = await this.readStateFile(versionPath, "release");
        return tag ? { tag, dir: undefined } : undefined;
    }

    private quote(value: string): string {
        return `'${value.replaceAll("'", `'"'"'`)}'`;
    }
}
