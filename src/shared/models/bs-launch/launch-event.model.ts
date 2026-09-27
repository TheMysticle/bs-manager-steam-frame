export interface BSLaunchEventData{
    type: BSLaunchEventType;
    data?: unknown;
}

export interface BSLaunchErrorData{
    type: BSLaunchError;
    data?: unknown;
}

export enum BSLaunchError{
    BS_NOT_FOUND = "EXE_NOT_FOUND",
    BS_ALREADY_RUNNING = "BS_ALREADY_RUNNING",
    OCULUS_NOT_RUNNING = "OCULUS_NOT_RUNNING",
    OCULUS_NOT_INSTALLED = "OCULUS_NOT_INSTALLED",
    BS_EXIT_ERROR = "EXIT",
    OCULUS_LIB_NOT_FOUND = "OCULUS_LIB_NOT_FOUND",
    PROTON_NOT_SET = "PROTON_NOT_SET",
    PROTON_NOT_FOUND = "PROTON_NOT_FOUND",
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
    ORIGINAL_OCULUS_NOT_INSTALLED = "ORIGINAL_OCULUS_NOT_INSTALLED",
    BS_ARM64_PROTON_MISMATCH = "BS_ARM64_PROTON_MISMATCH",
    // The dedicated native-ARM64 Proton setting (Settings > Native ARM64 Proton folder),
    // separate from the main "Proton folder" used to patch/launch regular instances.
    BS_ARM64_PROTON_NOT_SET = "BS_ARM64_PROTON_NOT_SET",
    BS_ARM64_PROTON_NOT_FOUND = "BS_ARM64_PROTON_NOT_FOUND"
}

export enum BSLaunchEvent{
    STEAM_LAUNCHING = "STEAM_LAUNCHING",
    STEAM_LAUNCHED = "STEAM_LAUNCHED",
    BS_LAUNCHING = "BS_LAUNCHING",
}

export enum BSLaunchWarning{
    UNABLE_TO_LAUNCH_STEAM = "UNABLE_TO_LAUNCH_STEAM",
}

export type BSLaunchEventType = BSLaunchEvent | BSLaunchWarning;
