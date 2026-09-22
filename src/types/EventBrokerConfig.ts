/** Configure under key "eventBroker" in Ts.ED configuration. */
export interface EventBrokerSnsConfig {
  topicArn: string;
}

export interface EventBrokerSqsConfig {
  queueUrl: string;
  enabled: boolean;
  /** Messages per ReceiveMessage call. Default 10. Lower it for services with slow handlers. */
  maxMessages?: number;
  /** Long-poll wait. Default 20. */
  pollingWaitTimeSeconds?: number;
  /**
   * Delete a message only after every listener resolved. Default false, which keeps the
   * historical behaviour: the message is deleted whether or not the handler succeeded.
   * Requires a RedrivePolicy (dead-letter queue) on the queue; start() refuses otherwise.
   */
  ackOnSuccess?: boolean;
  /**
   * Must equal the queue's VisibilityTimeout. While a handler runs the consumer extends the
   * message lease at half this interval. Default 30.
   */
  visibilityTimeoutSeconds?: number;
  /** Log `event.handler_slow` once a handler runs longer than this. The work is not cancelled. Default 60_000. */
  handlerSlowMs?: number;
  /** First retry delay in seconds; doubles per receive, capped at 900, jittered. Default 10. */
  retryBaseSeconds?: number;
  /** How long stop() waits for in-flight handlers before releasing their messages. Keep below the pod grace period. Default 25_000. */
  drainTimeoutMs?: number;
}

export type IdempotencyMode = "off" | "shadow" | "enforce";

export interface EventBrokerIdempotencyConfig {
  /**
   * off     — @OnSubscribe never touches the store.
   * shadow  — claim and count duplicates, but always run the handler.
   * enforce — a completed listener short-circuits; a listener held elsewhere rejects (retry).
   */
  mode: IdempotencyMode;
  /** One run's worth of lease. Default 2 × visibilityTimeoutSeconds. Not the retention. */
  leaseMs?: number;
  /** How long a "done" marker is kept. Must cover the replay horizon (DLQ retention). Default 14 days. */
  retentionSeconds?: number;
}

export interface EventBrokerConfig {
  region: string;
  /** Registry short name (social | auth | data | networkgraph). Part of every dedup key. Falls back to SERVICE_NAME. */
  serviceName?: string;
  sns: EventBrokerSnsConfig;
  sqs: EventBrokerSqsConfig;
  idempotency?: EventBrokerIdempotencyConfig;
}
