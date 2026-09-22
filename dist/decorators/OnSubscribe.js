import { OnEvent } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
import { randomUUID } from "node:crypto";
import { RetryableEventError } from "../errors/EventErrors.js";
import { eventBrokerDedupKey } from "../idempotency/IdempotencyStore.js";
import { getIdempotencyRuntime } from "../idempotency/runtime.js";
const LOG_PREFIX = "[event-broker]";
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
 * The wrapper is async so a synchronous throw becomes a rejection the consumer can see.
 */
export function OnSubscribe(eventName, opts = {}) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        const handlerId = opts.id ?? `${target.constructor.name}.${propertyKey}`;
        descriptor.value = async function (payload, ...args) {
            const eventId = extractEventId(payload);
            $log.info(`${LOG_PREFIX} Listener | eventName=${eventName} eventId=${eventId ?? "unknown"} listener=${handlerId}`);
            const { config, store } = getIdempotencyRuntime();
            const mode = config?.idempotency?.mode ?? "off";
            if (opts.idempotent === false || mode === "off" || !eventId) {
                return originalMethod.apply(this, [payload, ...args]);
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
                    return originalMethod.apply(this, [payload, ...args]);
                if (claim === "done")
                    return undefined; // this listener already ran: resolve so the consumer can ack
                throw new RetryableEventError(`${LOG_PREFIX} handler ${handlerId} in flight elsewhere for ${eventId}`);
            }
            try {
                const out = await originalMethod.apply(this, [payload, ...args]);
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
