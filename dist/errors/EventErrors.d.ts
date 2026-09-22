/**
 * The handler can never succeed for this payload (validation failure, missing id).
 * With ackOnSuccess the message is left for the queue's redrive policy instead of being retried.
 */
export declare class NonRetryableEventError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Explicitly retryable (dependency down, lease held by another consumer). Any other error a
 * handler throws is treated the same way; this class exists so intent reads in the code.
 */
export declare class RetryableEventError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
