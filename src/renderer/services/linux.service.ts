import { Observable } from "rxjs";
import { IpcService } from "./ipc.service";

export class LinuxService {

    private static instance: LinuxService;

    public static getInstance(): LinuxService {
        if (!LinuxService.instance) {
            LinuxService.instance = new LinuxService();
        }
        return LinuxService.instance;
    }

    private readonly ipc: IpcService;

    private constructor() {
        this.ipc = IpcService.getInstance();
    }

    public getWinePrefixPath(): Observable<string> {
        return this.ipc.sendV2("linux.get-wine-prefix-path");
    }

    public setProtonFolder(path: string): Observable<boolean> {
        return this.ipc.sendV2("linux.set-proton-folder", path);
    }

    public verifyProtonFolder(path?: string): Observable<boolean> {
        return this.ipc.sendV2("linux.verify-proton-folder", path);
    }

    public setBsArm64ProtonFolder(path: string): Observable<boolean> {
        return this.ipc.sendV2("linux.set-bs-arm64-proton-folder", path);
    }

    public verifyBsArm64ProtonFolder(path?: string): Observable<boolean> {
        return this.ipc.sendV2("linux.verify-bs-arm64-proton-folder", path);
    }

}
