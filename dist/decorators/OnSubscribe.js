import { OnEvent } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
import { randomUUID } from "node:crypto";
import { RetryableEventError } from "../errors/EventErrors.js";
import { eventBrokerDedupKey } from "../idempotency/IdempotencyStore.js";
import { getIdempotencyRuntime } from "../idempotency/runtime.js";
const LOG_PREFIX = "[event-broker]";
/**
 * Every handler id declared in this process. Duplicate ids are refused at decoration time, so
 * two listeners can never share a dedup key by accident; the same declaration re-registering
 * (test runners, hot reload) is allowed.
 */
const registry = new Map();
const instancesByHandler = new Map();
export function registeredHandlers() {
    return [...registry.values()];
}
/** For tests only. */
export function resetHandlerRegistry() {
    registry.clear();
    instancesByHandler.clear();
}
function extractEventId(payload) {
    if (typeof payload === "object" && payload !== null && "eventId" in payload) {
        const id = payload.eventId;
        if (typeof id === "string" && id.trim() !== "")
            return id;
    }
    return undefined;
}
/**
 * Subscribes to events from SQS, logs each invocation and — when `eventBroker.idempotency.mode`
 * is `shadow` or `enforce` — makes the listener idempotent per (service, eventId, handler id).
 *
 * Several listeners may subscribe to the same event, in one class or across classes. The consumer
 * acknowledges the message only when every listener resolved; a listener that failed is the only
 * one re-run on redelivery, because each keeps its own completion marker. Every failing listener
 * is logged individually (`listener_failed`), not just the first one the emitter reports.
 *
 * The wrapper is async so a synchronous throw becomes a rejection the consumer can see.
 */
export function OnSubscribe(eventName, opts = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        const owner = `${target.constructor.name}.${propertyKey}`;
        const handlerId = opts.id ?? owner;
        const idempotent = opts.idempotent !== false;
        const existing = registry.get(handlerId);
        if (existing && existing.owner !== owner) {
            throw new Error(`${LOG_PREFIX} handler id "${handlerId}" (event ${eventName}, ${owner}) is already used by ${existing.owner} (event ${existing.eventName}); handler ids must be unique per service`);
        }
        registry.set(handlerId, { eventName, handlerId, owner, idempotent });
        descriptor.value = async function (payload, ...args) {
            const eventId = extractEventId(payload);
            $log.info(`${LOG_PREFIX} Listener | eventName=${eventName} eventId=${eventId ?? "unknown"} listener=${handlerId}`);
            noteInstance(handlerId, owner, this);
            const run = async () => {
                try {
                    return await originalMethod.apply(this, [payload, ...args]);
                }
                catch (err) {
                    const e = err;
                    $log.error({
                        metric: "event_outcome",
                        outcome: "listener_failed",
                        eventName,
                        handlerId,
                        eventId: eventId ?? "unknown",
                        error: `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`,
                    });
                    throw err;
                }
            };
            const { config, store } = getIdempotencyRuntime();
            const mode = config?.idempotency?.mode ?? "off";
            if (!idempotent || mode === "off" || !eventId) {
                return run();
            }
            if (!store) {
                // Fail closed: never process without dedup when dedup was asked for.
                throw new RetryableEventError(`${LOG_PREFIX} idempotency mode=${mode} but no IDEMPOTENCY_STORE provider is registered`);
            }
            const service = config?.serviceName ?? process.env.SERVICE_NAME ?? "unknown";
            const key = eventBrokerDedupKey(service, eventId, handlerId);
            const token = randomUUID();
            const leaseMs = config?.idempotency?.leaseMs ?? (config?.sqs?.visibilityTimeoutSeconds ?? 30) * 2000;
            const retention = config?.idempotency?.retentionSeconds ?? 14 * 86400;
            let claim;
            try {
                claim = await store.claim(key, token, leaseMs);
            }
            catch (err) {
                // Store down: do not process, do not ack. The queue builds and the age alarm says so.
                throw new RetryableEventError(`${LOG_PREFIX} idempotency store unavailable: ${err?.message ?? String(err)}`, err);
            }
            if (claim !== "claimed") {
                $log.info({ metric: "event_outcome", outcome: "duplicate_detected", claim, eventName, handlerId, eventId, mode, service });
                if (mode === "shadow")
                    return run();
                if (claim === "done")
                    return undefined; // this listener already ran: resolve so the consumer can ack
                throw new RetryableEventError(`${LOG_PREFIX} handler ${handlerId} in flight elsewhere for ${eventId}`);
            }
            try {
                const out = await run();
                await store.complete(key, token, retention);
                return out;
            }
            catch (err) {
                await store.release(key, token).catch(() => undefined);
                throw err;
            }
        };
        return OnEvent(eventName)(target, propertyKey, descriptor);
    };
}
/**
 * The same handler bound on more than one instance means the class was registered twice with the
 * DI container (e.g. both @Service() and @Injectable({ token })): every event runs it twice.
 * Warn once; in enforce mode the second run short-circuits on the shared marker.
 */
function noteInstance(handlerId, owner, instance) {
    let seen = instancesByHandler.get(handlerId);
    if (!seen) {
        seen = new Set();
        instancesByHandler.set(handlerId, seen);
    }
    if (seen.has(instance))
        return;
    seen.add(instance);
    if (seen.size === 2) {
        $log.warn(`${LOG_PREFIX} event.handler_registered_twice | listener=${handlerId} (${owner}) is bound on ${seen.size} instances; check the class is registered with the container once`);
    }
}
