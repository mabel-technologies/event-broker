/** Configure under key "eventBroker" in Ts.ED configuration. */
export interface EventBrokerSnsConfig {
  topicArn: string;
}

export interface EventBrokerSqsConfig {
  queueUrl: string;
  enabled: boolean;
  maxMessages?: number;
  pollingWaitTimeSeconds?: number;
}

export interface EventBrokerConfig {
  region: string;
  sns: EventBrokerSnsConfig;
  sqs: EventBrokerSqsConfig;
}
