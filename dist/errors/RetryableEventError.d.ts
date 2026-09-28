/** Optional: throw for a transient failure to make handler intent explicit. Retryable is
 * already the default for anything a handler throws that isn't a NonRetryableEventError. */
export declare class RetryableEventError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
