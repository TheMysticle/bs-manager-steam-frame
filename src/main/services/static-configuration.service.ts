import ElectronStore from "electron-store";
import { Observable, Subject } from "rxjs";
import { BSVersion } from "shared/bs-version.interface";
import { AutoUpdate } from "shared/models/config";

export class StaticConfigurationService {
    private static instance: StaticConfigurationService;

    public static getInstance(): StaticConfigurationService {
        if (!StaticConfigurationService.instance) {
            StaticConfigurationService.instance = new StaticConfigurationService();
        }
        return StaticConfigurationService.instance;
    }

    private readonly store: ElectronStore;

    private readonly watchers: {
        [K in StaticConfigKeys]?: Subject<StaticConfigKeyValues[K]>;
    } = {};

    private constructor() {
        this.store = new ElectronStore();
    }

    public has<K extends StaticConfigKeys>(key: K): boolean {
        return this.store.has(key);
    }

    public get<K extends StaticConfigKeys>(key: K, defaultValue?: StaticConfigKeyValues[K]): StaticConfigKeyValues[K] {
        return this.store.get<K>(key, defaultValue) as StaticConfigKeyValues[K];
    }

    public take<K extends StaticConfigKeys>(key: K, cb: (val: StaticConfigKeyValues[K]) => void): void {
        cb(this.get(key));
    }

    public async set<K extends StaticConfigKeys>(key: K, value: StaticConfigKeyValues[K]): Promise<void> {
        this.store.set(key, value);

        if (this.watchers[key]) {
            this.watchers[key].next(value); // update watchers if any
        }
    }

    public delete<K extends StaticConfigKeys>(key: K): void {
        this.store.delete(key);
    }

    public getStore(): ElectronStore {
        return this.store;
    }

    public $watch<K extends StaticConfigKeys>(key: K): Observable<StaticConfigKeyValues[K]> {
        if (!this.watchers[key]) {
            this.watchers[key] = new Subject() as any; // avoid type error here, the essential is that it work using the function
        }

        return this.watchers[key];
    }
}

export interface StaticConfigKeyValues {
    "installation-folder": string;
    "song-details-cache-etag": string;
    "disable-hadware-acceleration": boolean;
    "use-symlinks": boolean;
    "use-system-proxy": boolean;
    "close-bs-manager-on-launch": boolean;
    "last-version-launched": BSVersion;
    "auto-update": AutoUpdate;

    // Linux Specific static configs
    "proton-folder": string;
    // Proton build bs-arm64 (the native ARM64 build) was installed against, e.g.
    // "Proton 11.0 (ARM64)". Kept separate from "proton-folder" above: that one patches/
    // launches regular instances (and today needs Proton Experimental for BSIPA), while
    // this one must be the exact Proton bs-arm64's Wine builtins were compiled for.
    "bs-arm64-proton-folder": string;
    "versions": BSVersion[];
};

export type StaticConfigKeys = keyof StaticConfigKeyValues;

export type StaticConfigGetIpcRequestResponse<K extends StaticConfigKeys> = {
    request: K;
    response: StaticConfigKeyValues[K];
};

export type StaticConfigSetIpcRequest<K extends StaticConfigKeys> = {
    request: { key: K, value: StaticConfigKeyValues[K] };
    response: void;
};
