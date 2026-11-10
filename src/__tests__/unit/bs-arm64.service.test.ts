import { findBsArm64ReleaseAsset, findBsArm64ReleaseAssetByName, GithubRelease, newestBsArm64Release, selectBsArm64Release } from "main/services/bs-arm64.service";
import { BS_ARM64_FALLBACK_VERSIONS, BsArm64Manifest } from "shared/models/bs-arm64/bs-arm64.model";

jest.mock("electron", () => ({ app: { getPath: () => "", getVersion: () => "0.0.0" } }));
jest.mock("electron-log", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("main/services/bs-local-version.service", () => ({ BSLocalVersionService: { getInstance: jest.fn() } }));
jest.mock("main/services/installation-location.service", () => ({ InstallationLocationService: { getInstance: jest.fn() } }));
jest.mock("main/services/linux.service", () => ({ LinuxService: { getInstance: jest.fn() } }));
jest.mock("main/services/request.service", () => ({ RequestService: { getInstance: jest.fn() } }));

function release(tag: string, protonTags: string[], extra: Partial<GithubRelease> = {}): GithubRelease {
    return {
        tag_name: tag,
        draft: false,
        prerelease: false,
        assets: protonTags.flatMap(p => [
            { name: `bs-arm64-${tag}-${p}.tar.gz`, browser_download_url: `https://x/${tag}/${p}.tar.gz` },
            { name: `bs-arm64-${tag}-${p}.tar.gz.sha256`, browser_download_url: `https://x/${tag}/${p}.sha256` },
        ]),
        ...extra,
    };
}

function manifest(tag: string, protonVersions: Record<string, string>, bsVersions: string[]): BsArm64Manifest {
    return {
        version: tag,
        proton: Object.keys(protonVersions)[0],
        protonVersions: Object.fromEntries(Object.entries(protonVersions).map(([protonTag, builtFor]) => [protonTag, { artifact: `bs-arm64-${tag}-${builtFor}.tar.gz` }])),
        unityVersions: ["6000.3.19f1"],
        bsVersions,
        bsipaVersions: ["4.3.7"],
    };
}

describe("findBsArm64ReleaseAsset (manifest)", () => {
    // One tarball built against 2c, declared to work on 2e as well
    const v2 = release("v0.4.1", ["proton-11.0-2c"]);
    const m = manifest("v0.4.1", { "proton-11.0-2c": "proton-11.0-2c", "proton-11.0-2e": "proton-11.0-2c" }, ["1.45.1", "1.45.2"]);

    it("installs the asset the manifest names for the Proton build", () => {
        expect(findBsArm64ReleaseAsset(v2, m, "proton-11.0-2c-arm64")?.asset.name).toBe("bs-arm64-v0.4.1-proton-11.0-2c.tar.gz");
        expect(findBsArm64ReleaseAsset(v2, m, "proton-11.0-2e-arm64")?.asset.name).toBe("bs-arm64-v0.4.1-proton-11.0-2c.tar.gz");
    });

    it("matches the Proton tag exactly, not as a prefix of another build", () => {
        expect(findBsArm64ReleaseAsset(v2, m, "proton-11.0-2cd-arm64")).toBeUndefined();
        expect(findBsArm64ReleaseAsset(v2, m, "proton-11.0-3-arm64")).toBeUndefined();
    });

    it("finds nothing without a Proton build or when the named asset is missing", () => {
        expect(findBsArm64ReleaseAsset(v2, m, undefined)).toBeUndefined();
        const broken = manifest("v0.4.1", { "proton-11.0-2c": "proton-11.0-2d" }, ["1.45.1"]);
        expect(findBsArm64ReleaseAsset(v2, broken, "proton-11.0-2c-arm64")).toBeUndefined();
    });
});

describe("findBsArm64ReleaseAssetByName (releases without a manifest)", () => {
    const releases = [
        release("v0.2.0", ["proton-11.0-3"]),
        release("v0.1.1", ["proton-11.0-2c"]),
        release("v0.1.0", ["proton-11.0-2c"]),
    ];

    it("picks the newest release built for the Proton build", () => {
        const match = findBsArm64ReleaseAssetByName(releases, "proton-11.0-2c-arm64");
        expect(match?.release.tag_name).toBe("v0.1.1");
        expect(match?.asset.name).toBe("bs-arm64-v0.1.1-proton-11.0-2c.tar.gz");
    });

    it("matches the Proton tag exactly, not as a prefix of another build", () => {
        expect(findBsArm64ReleaseAssetByName(releases, "proton-11.0-2cd-arm64")).toBeUndefined();
        expect(findBsArm64ReleaseAssetByName(releases, "proton-11.0-3-arm64")?.release.tag_name).toBe("v0.2.0");
    });

    it("skips drafts and prereleases", () => {
        const withDraft = [release("v0.3.0", ["proton-11.0-2c"], { draft: true }), release("v0.2.9", ["proton-11.0-2c"], { prerelease: true }), ...releases];
        expect(findBsArm64ReleaseAssetByName(withDraft, "proton-11.0-2c-arm64")?.release.tag_name).toBe("v0.1.1");
    });

    it("finds nothing without a Proton build or matching release", () => {
        expect(findBsArm64ReleaseAssetByName(releases, undefined)).toBeUndefined();
        expect(findBsArm64ReleaseAssetByName(releases, "proton-10.0-arm64")).toBeUndefined();
    });
});

describe("selectBsArm64Release", () => {
    const releases = [
        release("v0.5.0", ["proton-11.0-2c"], { draft: true }),
        release("v0.4.1", ["proton-11.0-2c"]),
        release("v1.45.1-1.45.2", ["proton-11.0-2c"]),
    ];
    const m = manifest("v0.4.1", { "proton-11.0-2c": "proton-11.0-2c", "proton-11.0-2e": "proton-11.0-2c" }, ["1.45.1", "1.45.2", "1.45.3"]);

    it("reads the newest published release, skipping drafts", () => {
        expect(newestBsArm64Release(releases)?.tag_name).toBe("v0.4.1");
    });

    it("with a manifest: the newest release decides the asset and the supported game versions", () => {
        const info = selectBsArm64Release(releases, m, "proton-11.0-2e-arm64");
        expect(info.match?.release.tag_name).toBe("v0.4.1");
        expect(info.match?.asset.name).toBe("bs-arm64-v0.4.1-proton-11.0-2c.tar.gz");
        expect(info.supportedVersions).toEqual(["1.45.1", "1.45.2", "1.45.3"]);
        expect(info.manifest).toBe(m);
    });

    it("with a manifest: no match when the newest release doesn't list the Proton build, even if an older release would", () => {
        const info = selectBsArm64Release(releases, m, "proton-11.0-3-arm64");
        expect(info.match).toBeUndefined();
        expect(info.supportedVersions).toEqual(["1.45.1", "1.45.2", "1.45.3"]);
    });

    it("without a manifest: falls back to asset names and the built-in version list", () => {
        const info = selectBsArm64Release(releases, undefined, "proton-11.0-2c-arm64");
        expect(info.match?.release.tag_name).toBe("v0.4.1");
        expect(info.supportedVersions).toBe(BS_ARM64_FALLBACK_VERSIONS);
        expect(info.manifest).toBeUndefined();
        // Only 2c was ever built by name; 2e needs a manifest to be offered
        expect(selectBsArm64Release(releases, undefined, "proton-11.0-2e-arm64").match).toBeUndefined();
    });
});
