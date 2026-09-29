/**
 * Native ARM64 build of Beat Saber for ARM64 Proton (e.g. the Steam Frame).
 * The runtime itself lives in https://github.com/TheMysticle/bs-arm64, ported from
 * DaVarga/bs-arm64 (originally 1.44.1-only) to target 1.45.1 instead. BSManager
 * downloads its release matching the selected Proton build and runs its installer.
 *
 * A bs-arm64 release's versions.env pins one Unity build (UNITY_VERSION) but can list
 * several compatible GAME_VERSION_COMPAT entries when a game update didn't touch any
 * file the runtime replaces or patches. 1.45.2 (2026-09-29) is one such case: it's a
 * content-only patch (one song, a couple of beatmap/audio/editor data fixes) -- every
 * Managed/*.dll, Beat Saber.exe and UnityPlayer.dll are byte-identical to 1.45.1, and
 * the Unity version (6000.3.19f1) didn't change. The installer re-checks this itself.
 */

export const BS_ARM64_REPOSITORY = "TheMysticle/bs-arm64";

// Game versions the bs-arm64 releases support (the installer checks it again).
export const BS_ARM64_SUPPORTED_VERSIONS = ["1.45.1", "1.45.2"];

export enum BsArm64Unsupported {
    NOT_LINUX_ARM64 = "NOT_LINUX_ARM64",
    PROTON_NOT_ARM64 = "PROTON_NOT_ARM64",
    VERSION_NOT_SUPPORTED = "VERSION_NOT_SUPPORTED",
}

export interface BsArm64Status {
    // Why this instance can't be patched; undefined when it can
    unsupported?: BsArm64Unsupported;
    installed: boolean;
    // Installed with mod support (ARM64 BSIPA fixes)
    mods: boolean;
    // Build of the selected Proton, e.g. "proton-11.0-2c-arm64"
    protonVersion?: string;
    // Proton build the installed files were set up for
    installedProtonVersion?: string;
    // bs-arm64 release the instance was patched with, e.g. "v0.1.1"
    installedRelease?: string;
}

export interface BsArm64InstallOptions {
    mods: boolean;
}

export interface BsArm64Progress {
    // Output line of the download or installer, for the log view
    log?: string;
    // Download progress, 0-100
    percent?: number;
}

export enum BsArm64Error {
    NO_MATCHING_RELEASE = "BS_ARM64_NO_MATCHING_RELEASE",
    CHECKSUM_MISMATCH = "BS_ARM64_CHECKSUM_MISMATCH",
    INSTALLER_FAILED = "BS_ARM64_INSTALLER_FAILED",
}
