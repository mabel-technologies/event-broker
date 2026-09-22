import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
import { type IdempotencyStore } from "./IdempotencyStore.js";
export interface IdempotencyRuntime {
    config: EventBrokerConfig | undefined;
    store: IdempotencyStore | undefined;
}
/** Resolve config and store from the Ts.ED injector. Tests replace this with setIdempotencyRuntime(). */
export declare function getIdempotencyRuntime(): IdempotencyRuntime;
/** For tests only: bypass the injector. Pass null to restore normal resolution. */
export declare function setIdempotencyRuntime(runtime: IdempotencyRuntime | null): void;
