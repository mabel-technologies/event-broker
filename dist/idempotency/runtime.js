import { injector } from "@tsed/di";
import { IDEMPOTENCY_STORE } from "./IdempotencyStore.js";
let override = null;
/** Resolve config and store from the Ts.ED injector. Tests replace this with setIdempotencyRuntime(). */
export function getIdempotencyRuntime() {
    if (override)
        return override;
    try {
        const inj = injector();
        const config = inj.settings.get("eventBroker");
        const store = inj.has(IDEMPOTENCY_STORE) ? (inj.get(IDEMPOTENCY_STORE) ?? undefined) : undefined;
        return { config, store };
    }
    catch {
        return { config: undefined, store: undefined };
    }
}
/** For tests only: bypass the injector. Pass null to restore normal resolution. */
export function setIdempotencyRuntime(runtime) {
    override = runtime;
}
