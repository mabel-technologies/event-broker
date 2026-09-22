export type ClaimResult = "claimed" | "in_flight" | "done";

/** DI token. Each service registers exactly one implementation. */
export const IDEMPOTENCY_STORE = Symbol.for("event-broker:idempotency-store");

export interface IdempotencyStore {
  /**
   * Atomically take ownership of `key` for `leaseMs`. "claimed" if this call now owns it,
   * "done" if a previous run completed and the marker has not expired, "in_flight" if another
   * live lease holds it. An expired in-flight lease is taken over (the previous runner crashed).
   * Any error thrown here makes the listener reject, so the message is neither processed nor
   * acknowledged (fail closed).
   */
  claim(key: string, token: string, leaseMs: number): Promise<ClaimResult>;
  /** Mark done. Only the token that claimed may complete; the marker lives retentionSeconds. */
  complete(key: string, token: string, retentionSeconds: number): Promise<void>;
  /** Give the claim back after a failure so the redelivery can claim it. Only the owning token may release. */
  release(key: string, token: string): Promise<void>;
}

/**
 * The dedup key used by @OnSubscribe. Handlers that write the "done" marker inside their own
 * database transaction build the same key with this helper.
 */
export function eventBrokerDedupKey(service: string, eventId: string, handlerId: string): string {
  return `evt:${service}:${eventId}:${handlerId}`;
}

/**
 * Test-suite guard: every handler id in a service must be explicit and unique. Call it from a
 * spec with the values of the service's handler-id constants.
 */
export function assertUniqueHandlerIds(ids: readonly string[], opts: { forbidFallback?: boolean } = {}): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || typeof id !== "string") throw new Error(`[event-broker] handler id must be a non-empty string, got ${String(id)}`);
    if (opts.forbidFallback && /^[A-Z][A-Za-z0-9]*\.[A-Za-z0-9_]+$/.test(id)) {
      throw new Error(`[event-broker] handler id "${id}" looks like a Class.method fallback; set an explicit id`);
    }
    if (seen.has(id)) throw new Error(`[event-broker] duplicate handler id "${id}"`);
    seen.add(id);
  }
}
