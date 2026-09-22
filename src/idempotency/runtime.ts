import { injector } from "@tsed/di";
import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
import { IDEMPOTENCY_STORE, type IdempotencyStore } from "./IdempotencyStore.js";

export interface IdempotencyRuntime {
  config: EventBrokerConfig | undefined;
  store: IdempotencyStore | undefined;
}

let override: IdempotencyRuntime | null = null;

/** Resolve config and store from the Ts.ED injector. Tests replace this with setIdempotencyRuntime(). */
export function getIdempotencyRuntime(): IdempotencyRuntime {
  if (override) return override;
  try {
    const inj = injector();
    const config = inj.settings.get("eventBroker") as EventBrokerConfig | undefined;
    const store = inj.has(IDEMPOTENCY_STORE) ? (inj.get<IdempotencyStore>(IDEMPOTENCY_STORE) ?? undefined) : undefined;
    return { config, store };
  } catch {
    return { config: undefined, store: undefined };
  }
}

/** For tests only: bypass the injector. Pass null to restore normal resolution. */
export function setIdempotencyRuntime(runtime: IdempotencyRuntime | null): void {
  override = runtime;
}
