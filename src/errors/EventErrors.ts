/**
 * The handler can never succeed for this payload (validation failure, missing id).
 * With ackOnSuccess the message is left for the queue's redrive policy instead of being retried.
 */
export class NonRetryableEventError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NonRetryableEventError";
  }
}

/**
 * Explicitly retryable (dependency down, lease held by another consumer). Any other error a
 * handler throws is treated the same way; this class exists so intent reads in the code.
 */
export class RetryableEventError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RetryableEventError";
  }
}
