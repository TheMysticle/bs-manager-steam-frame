/**
 * Native ARM64 build of Beat Saber for ARM64 Proton (e.g. the Steam Frame).
 * The runtime itself lives in https://github.com/TheMysticle/bs-arm64, ported from
 * DaVarga/bs-arm64 (originally 1.44.1-only) to target 1.45.1 instead. BSManager
 * downloads its release matching the selected Proton build and runs its installer.
 *
 * Since DaVarga's 0.3.2 each release ships a bs-arm64-manifest.json naming the Proton
 * versions it works with (and which tarball to install for each) and the Beat Saber
 * versions it was tested with. BSManager reads that instead of guessing from asset
 * names; releases without one (this fork's v1.45.1-1.45.2 and older) still work the
 * old way, with BS_ARM64_FALLBACK_VERSIONS as the supported list.
 */

export const BS_ARM64_REPOSITORY = "TheMysticle/bs-arm64";

// bs-arm64-manifest.json of a release (DaVarga 0.3.2 and later): what the release was tested with
export const BS_ARM64_MANIFEST_ASSET = "bs-arm64-manifest.json";

export interface BsArm64ProtonVersion {
    // Release asset to install for this Proton version, e.g. "bs-arm64-v0.4.1-proton-11.0-2c.tar.gz"
    artifact: string;
}

export interface BsArm64Manifest {
    version: string;
    // Proton version the DLLs are built against (kept for older BSManager versions)
    proton: string;
    // Proton versions the DLLs work with, by Proton tag ("proton-11.0-2e"), each tested on the Steam Frame
    protonVersions: Record<string, BsArm64ProtonVersion>;
    unityVersions: string[];
    bsVersions: string[];
    bsipaVersions: string[];
}

// Game versions to assume when the newest release has no manifest, or GitHub can't be reached.
// A bs-arm64 release's versions.env pins one Unity build (UNITY_VERSION) but can list several
// compatible GAME_VERSION_COMPAT entries when a game update didn't touch any file the runtime
// replaces or patches. 1.45.2 (2026-09-29) is one such case: it's a content-only patch (one song,
// a couple of beatmap/audio/editor data fixes) -- every Managed/*.dll, Beat Saber.exe and
// UnityPlayer.dll are byte-identical to 1.45.1, and the Unity version (6000.3.19f1) didn't change.
export const BS_ARM64_FALLBACK_VERSIONS = ["1.45.1", "1.45.2"];

export enum BsArm64Unsupported {
    NOT_LINUX_ARM64 = "NOT_LINUX_ARM64",
    PROTON_NOT_ARM64 = "PROTON_NOT_ARM64",
    // The newest release has nothing for the selected Proton build
    NO_RELEASE = "NO_RELEASE",
    VERSION_NOT_SUPPORTED = "VERSION_NOT_SUPPORTED",
}

export interface BsArm64Status {
    // Why this instance can't be patched; undefined when it can
    unsupported?: BsArm64Unsupported;
    // Beat Saber versions the newest release was tested with (its manifest), else the fallback list
    supportedVersions?: string[];
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
