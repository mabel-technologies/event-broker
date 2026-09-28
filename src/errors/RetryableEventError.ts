/** Optional: throw for a transient failure to make handler intent explicit. Retryable is
 * already the default for anything a handler throws that isn't a NonRetryableEventError. */
export class RetryableEventError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RetryableEventError";
  }
}
