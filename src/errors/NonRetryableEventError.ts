/** Throw from an @OnSubscribe handler for a failure that can never succeed on retry (e.g. a
 * validation error). Routes the message to the DLQ instead of being backed off. Everything else
 * a handler throws is treated as retryable by default. */
export class NonRetryableEventError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NonRetryableEventError";
  }
}
