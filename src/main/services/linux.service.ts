import fs from "fs-extra";
import log from "electron-log";
import path from "path";
import { BS_APP_ID, BS_EXECUTABLE, IS_FLATPAK } from "main/constants";
import { InstallationLocationService } from "./installation-location.service";
import { StaticConfigurationService } from "./static-configuration.service";
import { CustomError } from "shared/models/exceptions/custom-error.class";
import { BSLaunchError, LaunchOption } from "shared/models/bs-launch";
import { BsmShellLog, bsmExec } from "main/helpers/os.helpers";
import { LaunchMods } from "shared/models/bs-launch/launch-option.interface";
import { SteamShortcutData } from "shared/models/steam/shortcut.model";
import { buildBsLaunchArgs } from "./bs-launcher/abstract-launcher.service";
import { parseLaunchOptions } from "main/helpers/launchOptions.helper";
import { tryit } from "shared/helpers/error.helpers";
import { isBsArm64Installed, isBsArm64ModsDisabled } from "main/helpers/bs-arm64.helpers";
import { SteamService } from "./steam.service";

// "default": BSManager's own Proton, used to patch/launch regular instances.
// "bs-arm64": the Proton build a native ARM64 (bs-arm64) instance was installed against -
// see buildBsArm64EnvVariables. Kept as a separate setting because the two can legitimately
// differ (e.g. Proton Experimental for BSIPA vs. Proton 11.0 (ARM64) for the native build).
export type ProtonKind = "default" | "bs-arm64";

export class LinuxService {
    private static instance: LinuxService;

    public static getInstance(): LinuxService {
        if (!LinuxService.instance) {
            LinuxService.instance = new LinuxService();
        }
        return LinuxService.instance;
    }

    private readonly PROTON_BINARY_PREFIX = "proton";
    private readonly ARM64_WINE_BINARY = path.join("files", "bin-arm64", "wine");
    // x86_64 Proton uses wine64; ARM64 Proton uses the unified Wine binary.
    // https://github.com/Zagrios/bs-manager/pull/586#issuecomment-2449228826
    private readonly WINE_BINARY_PREFIXES = [
        path.join("files", "bin", "wine64"),
        path.join("files", "lib", "wine", "x86_64-unix", "wine64"),
        this.ARM64_WINE_BINARY,
    ];

    private readonly installLocationService: InstallationLocationService;
    private readonly staticConfig: StaticConfigurationService;

    private nixOS: boolean | undefined;
    private winePath = "";
    private arm64WinePath = "";

    private constructor() {
        this.installLocationService = InstallationLocationService.getInstance();
        this.staticConfig = StaticConfigurationService.getInstance();
    }

    // === Launching === //

    public getCompatDataPath() {
        const sharedFolder = this.installLocationService.sharedContentPath();
        return path.resolve(sharedFolder, "compatdata");
    }

    public async getProtonPrefix(action: "run" | "runinprefix" = "run", kind: ProtonKind = "default") {
        const protonPath = await this.getProtonPath(kind);
        return await this.isNixOS()
            ? `steam-run "${protonPath}" ${action}`
            : `"${protonPath}" ${action}`;
    }

    private protonConfigKey(kind: ProtonKind): "proton-folder" | "bs-arm64-proton-folder" {
        return kind === "bs-arm64" ? "bs-arm64-proton-folder" : "proton-folder";
    }

    public getProtonFolder(kind: ProtonKind = "default"): string | undefined {
        const key = this.protonConfigKey(kind);
        return this.staticConfig.has(key) ? this.staticConfig.get(key) : undefined;
    }

    // Build of the selected Proton from its "version" file ("<timestamp> proton-11.0-2c-arm64")
    public getProtonBuild(kind: ProtonKind = "default"): string | undefined {
        const folder = this.getProtonFolder(kind);
        const versionFile = folder && path.join(folder, "version");
        if (!versionFile || !fs.existsSync(versionFile)) {
            return undefined;
        }
        return fs.readFileSync(versionFile, "utf8").trim().split(/\s+/)[1];
    }

    private async getProtonPath(kind: ProtonKind = "default"): Promise<string> {
        const key = this.protonConfigKey(kind);
        const [notSetError, notFoundError] = kind === "bs-arm64"
            ? [BSLaunchError.BS_ARM64_PROTON_NOT_SET, BSLaunchError.BS_ARM64_PROTON_NOT_FOUND]
            : [BSLaunchError.PROTON_NOT_SET, BSLaunchError.PROTON_NOT_FOUND];

        if (!this.staticConfig.has(key)) {
            throw CustomError.fromError(
                new Error(`${key} not set`),
                notSetError
            );
        }
        const protonPath = path.join(
            this.staticConfig.get(key),
            this.PROTON_BINARY_PREFIX
        );
        if (!fs.pathExistsSync(protonPath)) {
            throw CustomError.fromError(
                new Error("Could not locate proton binary"),
                notFoundError
            );
        }

        return protonPath;
    }

    // Which Proton kind to use for a given Beat Saber instance: bs-arm64's dedicated Proton
    // when it's a native ARM64-patched instance, otherwise BSManager's own default Proton.
    private protonKindFor(bsFolderPath: string): ProtonKind {
        return isBsArm64Installed(bsFolderPath) ? "bs-arm64" : "default";
    }

    public async buildEnvVariables(
        launchOptions: LaunchOption,
        steamPath: string,
        bsFolderPath: string
    ): Promise<Record<string, string>> {
        // Create the compat data path if it doesn't exist.
        // If the user never ran Beat Saber through steam before
        // using bsmanager, it won't exist, and proton will fail
        // to launch the game.
        const compatDataPath = this.getCompatDataPath();
        if (!fs.existsSync(compatDataPath)) {
            log.info(`Proton compat data path not found at '${compatDataPath}', creating directory`);
            await fs.ensureDir(compatDataPath);
        }

        // Setup Proton environment variables
        const envVars: Record<string, string> = {
            "WINEDLLOVERRIDES": "winhttp=n,b", // Required for mods to work
            "STEAM_COMPAT_DATA_PATH": compatDataPath,
            "STEAM_COMPAT_INSTALL_PATH": bsFolderPath,
            "STEAM_COMPAT_CLIENT_INSTALL_PATH": steamPath,
            "STEAM_COMPAT_APP_ID": BS_APP_ID,
            // Run game in steam environment; fixes #585 for unicode song titles
            "SteamEnv": "1",
            // Fix reflections in Monado
            "OXR_NO_TEXTURE_SOURCE_ALPHA": "1",
        };

        if (isBsArm64Installed(bsFolderPath)) {
            Object.assign(envVars, await this.buildBsArm64EnvVariables(steamPath, bsFolderPath));
        }

        if (launchOptions.launchMods?.includes(LaunchMods.PROTON_LOGS)) {
            envVars.PROTON_LOG = "1";
            envVars.PROTON_LOG_DIR = path.join(bsFolderPath, "Logs");
        }

        if (launchOptions.launchMods?.includes(LaunchMods.PARALLEL_VIEWS)) {
            envVars.OXR_PARALLEL_VIEWS = "1";
        }

        return envVars;
    }

    // Native ARM64 instance (bs-arm64): see bs-arm64.service.ts
    private async buildBsArm64EnvVariables(steamPath: string, bsFolderPath: string): Promise<Record<string, string>> {
        const runtimeDir = path.join(this.getCompatDataPath(), "pfx", "drive_c", "bs-arm64");
        const builtFor = tryit(() => fs.readFileSync(path.join(runtimeDir, "proton-version"), "utf8").trim()).result;
        const protonBuild = this.getProtonBuild("bs-arm64");
        if (builtFor !== protonBuild) {
            throw CustomError.fromError(
                new Error(`Native ARM64 files were set up for ${builtFor}, but Proton is ${protonBuild}`),
                BSLaunchError.BS_ARM64_PROTON_MISMATCH
            );
        }

        const envVars: Record<string, string> = {
            // lsteamclient_a64 / wineopenxr_a64 Wine builtins
            WINEDLLPATH: runtimeDir,
            // Without mod support BSIPA's x64 Doorstop is still there: never load it
            WINEDLLOVERRIDES: isBsArm64ModsDisabled(bsFolderPath) ? "winhttp=b" : "winhttp=n,b",
            // Valve's fdm_injection layer spins forever in vkCreateDevice under Proton ARM64
            DISABLE_VULKAN_FDM_INJECTION_LAYER: "1",
        };

        // Steam's "Foveated Rendering" game property drives bs-arm64's own eye-tracked
        // foveated rendering (DXVK + the bs-arm64 OpenXR layer) instead
        if (await SteamService.getInstance().isFoveatedRenderingEnabled(BS_APP_ID, steamPath).catch((): boolean => false)) {
            log.info("Steam's Foveated Rendering is on for Beat Saber: enabling bs-arm64 foveated rendering");
            envVars.BS_ARM64_FDM = "1";
        }

        return envVars;
    }

    public async setProtonFolder(protonFolder: string, kind: ProtonKind = "default"): Promise<boolean> {
        const trimmedProtonFolder = protonFolder.trim();
        if (!trimmedProtonFolder || !this.verifyProtonPath(trimmedProtonFolder, kind)) {
            return false;
        }

        await this.staticConfig.set(this.protonConfigKey(kind), trimmedProtonFolder);
        if (kind === "bs-arm64") {
            // Reset so a subsequent isArm64Wine("bs-arm64") re-checks against the new folder
            this.arm64WinePath = "";
        } else {
            this.winePath = "";
        }
        return true;
    }

    public verifyProtonPath(protonFolder: string = "", kind: ProtonKind = "default"): boolean {
        const key = this.protonConfigKey(kind);
        if (protonFolder === "") {
            if (!this.staticConfig.has(key)) {
                return false;
            }

            protonFolder = this.staticConfig.get(key);
        }

        // Check if the proton binary exists
        const protonPath = path.join(protonFolder, this.PROTON_BINARY_PREFIX);
        if (!this.isExecutableFile(protonPath)) {
            return false;
        }

        // Check if any wine64 here exists
        for (const winePath of this.WINE_BINARY_PREFIXES) {
            if (this.isExecutableFile(path.join(protonFolder, winePath))) {
                // Reset this, in the case where the user reselects a new proton folder
                if (kind === "bs-arm64") {
                    this.arm64WinePath = "";
                } else {
                    this.winePath = "";
                }
                return true;
            }
        }
        return false;
    }

    private isExecutableFile(filePath: string): boolean {
        try {
            if (!fs.pathExistsSync(filePath) || !fs.statSync(filePath).isFile()) {
                return false;
            }

            fs.accessSync(filePath, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    }

    public getWinePath(kind: ProtonKind = "default"): string {
        const cached = kind === "bs-arm64" ? this.arm64WinePath : this.winePath;
        if (cached) {
            return cached;
        }

        const key = this.protonConfigKey(kind);
        if (!this.staticConfig.has(key)) {
            throw new Error(`${key} variable not set`);
        }

        const protonFolder = this.staticConfig.get(key);
        let winePath = "";
        for (const prefixes of this.WINE_BINARY_PREFIXES) {
            winePath = path.join(protonFolder, prefixes);
            if (!fs.pathExistsSync(winePath)) {
                winePath = "";
                continue;
            }
            break;
        }

        if (winePath === "") {
            throw new Error(`"${winePath}" binary file not found`);
        }

        if (kind === "bs-arm64") {
            this.arm64WinePath = winePath;
        } else {
            this.winePath = winePath;
        }
        return winePath;
    }

    public isArm64Wine(kind: ProtonKind = "default"): boolean {
        return this.getWinePath(kind).endsWith(this.ARM64_WINE_BINARY);
    }

    // Should be different from winePath, this is the "WINEPREFIX" env var
    //   that points to the wine windows files directory
    public getWinePrefixPath(): string {
        const compatDataPath = this.getCompatDataPath();
        return fs.existsSync(compatDataPath)
            ? path.join(compatDataPath, "pfx") : "";
    }

    // === NixOS Specific === //

    public async isNixOS(): Promise<boolean> {
        if (this.nixOS !== undefined) {
            return this.nixOS;
        }

        try {
            await bsmExec("nixos-version", {
                log: BsmShellLog.Command,
                flatpak: { host: IS_FLATPAK },
            });
            this.nixOS = true;
        } catch (error) {
            log.info("Not NixOS", error);
            this.nixOS = false;
        }

        return this.nixOS;
    }

    // === Shortcuts === //

    private async getCommand(
        launchOptions: LaunchOption,
        steamPath: string,
        beatSaberFolderPath: string,
        commandPrefix?: string
    ): Promise<string> {
        commandPrefix ??= await this.getProtonPrefix("run", this.protonKindFor(beatSaberFolderPath));
        const launchEnv = await this.buildEnvVariables(
            launchOptions, steamPath, beatSaberFolderPath
        );

        const beatSaberExePath = path.join(beatSaberFolderPath, BS_EXECUTABLE);

        const {
            env: parsedEnv,
            args: parsedArgs,
            cmdlet,
        } = parseLaunchOptions(launchOptions.command, {
            commandReplacement: `${commandPrefix} "${beatSaberExePath}"`,
        });

        const args = buildBsLaunchArgs(launchOptions);
        log.debug("Launch arguments:", args, "Parsed arguments:", parsedArgs);
        if (parsedArgs) {
            args.unshift(parsedArgs);
        }

        const env = {
            ...launchEnv, ...parsedEnv,
            SteamAppId: BS_APP_ID,
            SteamOverlayGameId: BS_APP_ID,
            SteamGameId: BS_APP_ID,
        };
        const envString = Object.entries(env)
            .map(([ key, value ]) => `${key}="${value}"`)
            .join(" ");
        return `${envString} ${cmdlet} ${args.join(" ")}`;
    }

    public async createDesktopShortcut(
        shortcutPath: string,
        name: string,
        icon: string,
        launchOptions: LaunchOption,
        steamPath: string,
        beatSaberFolderPath: string
    ): Promise<boolean> {
        try {
            const command = await this.getCommand(
                launchOptions, steamPath, beatSaberFolderPath
            );

            const desktopEntry = [
                "[Desktop Entry]",
                "Type=Application",
                `Name=${name}`,
                `Icon=${icon}`,
                `Path=${beatSaberFolderPath}`,
                `Exec=${command}`
            ].join("\n");

            await fs.writeFile(shortcutPath, desktopEntry);
            log.info("Created shorcut at ", `"${shortcutPath}/${name}"`);
            return true;
        } catch (error) {
            log.error("Could not create shortcut", error);
            return false;
        }
    }

    public async getSteamShortcutData(
        shortcutName: string,
        icon: string,
        launchOptions: LaunchOption,
        steamPath: string,
        beatSaberFolderPath: string
    ): Promise<SteamShortcutData> {
        const protonPath = await this.getProtonPath(this.protonKindFor(beatSaberFolderPath));
        const command = await this.getCommand(
            launchOptions, steamPath, beatSaberFolderPath, "%command% run"
        );

        return {
            AppName: shortcutName,
            Exe: protonPath,
            StartDir: beatSaberFolderPath,
            icon,
            OpenVR: "\x01",
            LaunchOptions: command
        };
    }

}
