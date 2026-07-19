import * as http from 'node:http';
import type { FakeGoogle } from './handler.ts';
export declare function createFakeGoogleServer(fake: FakeGoogle): http.Server;
