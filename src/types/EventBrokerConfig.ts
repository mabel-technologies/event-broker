/** Configure under key "eventBroker" in Ts.ED configuration. */
export interface EventBrokerSnsConfig {
  topicArn: string;
}

export interface EventBrokerSqsConfig {
  queueUrl: string;
  enabled: boolean;
  maxMessages?: number;
  pollingWaitTimeSeconds?: number;
  /**
   * Default false: every message is deleted regardless of handler outcome (today's behaviour,
   * unchanged). Set true to delete only on success, back off retryable failures, and reject
   * poison/unlistened messages via native SQS redrive instead — do this only once the target
   * queue has a DLQ with a RedrivePolicy, or failures will just cycle forever.
   */
  ackOnSuccess?: boolean;
}

export interface EventBrokerConfig {
  region: string;
  sns: EventBrokerSnsConfig;
  sqs: EventBrokerSqsConfig;
}
