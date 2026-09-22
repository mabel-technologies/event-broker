# Changelog

## 1.1.0

Failure handling for the SQS consumer. Default behaviour is unchanged until `sqs.ackOnSuccess` is set.

### Added
- `sqs.ackOnSuccess` (default `false`): delete only after every listener resolved. Boot refuses it on a queue without a RedrivePolicy.
- `NonRetryableEventError` / `RetryableEventError`. Poison, no-listener and malformed messages are routed to the DLQ through native redrive (visibility 0), never `SendMessage`.
- Per-message exponential backoff with jitter (`sqs.retryBaseSeconds`), lease extension while a handler runs (`sqs.visibilityTimeoutSeconds`), `event.handler_slow` warning, graceful drain in `stop()` (`sqs.drainTimeoutMs`); `$onDestroy` now returns the promise.
- Startup validation (`assertReady()` on publisher and consumer): empty or unreachable topic/queue fails boot.
- Structured `event_outcome` counters and honest labels: `event.receive_failed`, `event.handler_failed`, `event.poisoned`, `event.no_listener`, `event.malformed`.
- `@OnSubscribe(name, { id, idempotent })` with per-listener idempotency (`idempotency.mode` off | shadow | enforce), `IdempotencyStore` contract, `IDEMPOTENCY_STORE` token, `eventBrokerDedupKey`, `assertUniqueHandlerIds`. Fails closed when the store is unavailable.
- `eventBrokerConfigFromEnv({ serviceName })` and `EVENT_BROKER_ENV`.
- `HeartbeatListener` under `./heartbeat` (`platform.heartbeat` → CloudWatch `Auclair/Events HeartbeatHandled`; peer: `@aws-sdk/client-cloudwatch`).
- Subpath exports: `./heartbeat`, `./typeorm` (inbox entity + store + migrations, outbox entity + repo + relay + `writeWithOutbox`), `./neo4j` (`Neo4jInboxStore`, constraint bootstrap, Cypher fragments), `./dynamo` (`DynamoIdempotencyStore`), `./testing` (Floci helpers, `FakeEmitter`, `buildConsumer`).
- Unit tests (vitest) and a Floci integration suite (`npm run test:floci`).

### Changed
- Receive errors now back off 1 s → 30 s instead of rescheduling immediately; the "further errors suppressed" flag is gone.
- One throwing message no longer aborts the rest of its batch.
- `typeorm`, `neo4j-driver`, `@aws-sdk/client-dynamodb` and `@aws-sdk/client-cloudwatch` are optional peer dependencies, needed only by the subpath that uses them; the root import pulls in nothing new.

## 1.0.1
- Previous release.
