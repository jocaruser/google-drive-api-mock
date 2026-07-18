import { DriveStore, type DriveStoreOptions } from './store.ts';
export interface FakeGoogle {
    store: DriveStore;
    handle(request: Request): Promise<Response>;
}
export declare function createFakeGoogle(options: DriveStoreOptions): FakeGoogle;
