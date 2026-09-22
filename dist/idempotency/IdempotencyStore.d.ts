export type ClaimResult = "claimed" | "in_flight" | "done";
/** DI token. Each service registers exactly one implementation. */
export declare const IDEMPOTENCY_STORE: unique symbol;
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
export declare function eventBrokerDedupKey(service: string, eventId: string, handlerId: string): string;
/**
 * Test-suite guard: every handler id in a service must be explicit and unique. Call it from a
 * spec with the values of the service's handler-id constants.
 */
export declare function assertUniqueHandlerIds(ids: readonly string[], opts?: {
    forbidFallback?: boolean;
}): void;
