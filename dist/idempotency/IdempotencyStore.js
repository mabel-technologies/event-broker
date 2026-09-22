/** DI token. Each service registers exactly one implementation. */
export const IDEMPOTENCY_STORE = Symbol.for("event-broker:idempotency-store");
/**
 * The dedup key used by @OnSubscribe. Handlers that write the "done" marker inside their own
 * database transaction build the same key with this helper.
 */
export function eventBrokerDedupKey(service, eventId, handlerId) {
    return `evt:${service}:${eventId}:${handlerId}`;
}
/**
 * Test-suite guard: every handler id in a service must be explicit and unique. Call it from a
 * spec with the values of the service's handler-id constants.
 */
export function assertUniqueHandlerIds(ids, opts = {}) {
    const seen = new Set();
    for (const id of ids) {
        if (!id || typeof id !== "string")
            throw new Error(`[event-broker] handler id must be a non-empty string, got ${String(id)}`);
        if (opts.forbidFallback && /^[A-Z][A-Za-z0-9]*\.[A-Za-z0-9_]+$/.test(id)) {
            throw new Error(`[event-broker] handler id "${id}" looks like a Class.method fallback; set an explicit id`);
        }
        if (seen.has(id))
            throw new Error(`[event-broker] duplicate handler id "${id}"`);
        seen.add(id);
    }
}
