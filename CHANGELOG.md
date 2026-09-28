# Changelog

## 1.1.0

Rewrites `SqsConsumer` to support proper failure handling, shipped **dark** — default behaviour
is unchanged from 1.0.1 until a service explicitly sets `sqs.ackOnSuccess: true` (and only after
its queue has a DLQ with a `RedrivePolicy` — see README "Failure handling").

- **Fixed regardless of the flag** (these were bugs, not behaviour changes worth gating):
  - A throw from one message in a batch no longer aborts the rest of the batch, and no longer gets
    mislabelled as a receive failure.
  - The poll loop backs off (1s → 30s) on repeated `ReceiveMessage` failures instead of spinning.
  - `stop()` is now async and waits for in-flight message processing (capped at 25s) before
    returning; `EventBrokerModule.$onDestroy` now returns that promise so Ts.ED actually awaits it.
  - `start()` now validates the queue is reachable before polling begins, instead of only failing
    on the first receive.
- **New, opt-in via `sqs.ackOnSuccess: true`:**
  - Messages are deleted only on success; failures are backed off (exponential + jitter) instead.
  - New `NonRetryableEventError` / `RetryableEventError` exports for handlers to signal intent.
  - Poison messages (no listener, unparseable body, missing `eventType`, or a thrown
    `NonRetryableEventError`) are routed to the DLQ via native SQS redrive instead of deleted.
  - New log labels: `event.receive_failed`, `event.handler_failed`, `event.poisoned`.

## 1.0.1

Prior release.
