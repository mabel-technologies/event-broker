import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
/** The one place the environment variable names live. Mirror any change in ai-sound-service-configs. */
export declare const EVENT_BROKER_ENV: {
    readonly REGION: "EVENT_BROKER_REGION";
    readonly TOPIC_ARN: "EVENT_BROKER_SNS_TOPIC_ARN";
    readonly QUEUE_URL: "EVENT_BROKER_SQS_QUEUE_URL";
    readonly MAX_MESSAGES: "EVENT_BROKER_SQS_MAX_MESSAGES";
    readonly POLL_WAIT: "EVENT_BROKER_SQS_POLL_WAIT";
    readonly ACK_ON_SUCCESS: "EVENT_BROKER_SQS_ACK_ON_SUCCESS";
    readonly VISIBILITY: "EVENT_BROKER_SQS_VISIBILITY_TIMEOUT";
    readonly IDEMPOTENCY_MODE: "EVENT_BROKER_IDEMPOTENCY_MODE";
    /** DynamoDB adapter only. */
    readonly IDEMPOTENCY_TABLE: "EVENT_BROKER_IDEMPOTENCY_TABLE";
};
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
/** Build the `eventBroker` configuration block from the standard environment variables. */
export declare function eventBrokerConfigFromEnv(options: FromEnvOptions): EventBrokerConfig;
