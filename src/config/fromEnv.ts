import type { EventBrokerConfig, IdempotencyMode } from "../types/EventBrokerConfig.js";

/** The one place the environment variable names live. Mirror any change in ai-sound-service-configs. */
export const EVENT_BROKER_ENV = {
  REGION: "EVENT_BROKER_REGION",
  TOPIC_ARN: "EVENT_BROKER_SNS_TOPIC_ARN",
  QUEUE_URL: "EVENT_BROKER_SQS_QUEUE_URL",
  MAX_MESSAGES: "EVENT_BROKER_SQS_MAX_MESSAGES",
  POLL_WAIT: "EVENT_BROKER_SQS_POLL_WAIT",
  ACK_ON_SUCCESS: "EVENT_BROKER_SQS_ACK_ON_SUCCESS",
  VISIBILITY: "EVENT_BROKER_SQS_VISIBILITY_TIMEOUT",
  IDEMPOTENCY_MODE: "EVENT_BROKER_IDEMPOTENCY_MODE",
  /** DynamoDB adapter only. */
  IDEMPOTENCY_TABLE: "EVENT_BROKER_IDEMPOTENCY_TABLE",
} as const;

export interface FromEnvOptions {
  /** Registry short name: social | auth | data | networkgraph. */
  serviceName: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Name of the variable holding the queue URL, for a chart that has not yet moved to
   * EVENT_BROKER_SQS_QUEUE_URL. Delete the override once it has.
   */
  queueUrlVar?: string;
  /** Set false for a service that only publishes. Default true. */
  consume?: boolean;
}

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

/** Build the `eventBroker` configuration block from the standard environment variables. */
export function eventBrokerConfigFromEnv(options: FromEnvOptions): EventBrokerConfig {
  const { serviceName, env = process.env, queueUrlVar = EVENT_BROKER_ENV.QUEUE_URL, consume = true } = options;
  const visibility = num(env[EVENT_BROKER_ENV.VISIBILITY], 30);
  const mode = (env[EVENT_BROKER_ENV.IDEMPOTENCY_MODE] as IdempotencyMode | undefined) || "off";
  if (!["off", "shadow", "enforce"].includes(mode)) {
    throw new Error(`[event-broker] ${EVENT_BROKER_ENV.IDEMPOTENCY_MODE} must be off | shadow | enforce, got "${mode}"`);
  }
  return {
    region: env[EVENT_BROKER_ENV.REGION] || "us-east-2",
    serviceName,
    sns: { topicArn: env[EVENT_BROKER_ENV.TOPIC_ARN] || "" },
    sqs: {
      queueUrl: env[queueUrlVar] || "",
      enabled: consume,
      maxMessages: num(env[EVENT_BROKER_ENV.MAX_MESSAGES], 10),
      pollingWaitTimeSeconds: num(env[EVENT_BROKER_ENV.POLL_WAIT], 20),
      ackOnSuccess: env[EVENT_BROKER_ENV.ACK_ON_SUCCESS] === "true",
      visibilityTimeoutSeconds: visibility,
      drainTimeoutMs: 25_000,
    },
    idempotency: {
      mode,
      leaseMs: 2 * visibility * 1000,
      retentionSeconds: 14 * 86_400,
    },
  };
}
