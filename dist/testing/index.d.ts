/**
 * Helpers for integration tests against the local Floci stack (`npm run local:up` in
 * event-broker). Point the AWS SDK at it with AWS_ENDPOINT_URL=http://localhost:4566,
 * AWS_ACCESS_KEY_ID=test, AWS_SECRET_ACCESS_KEY=test, AWS_DEFAULT_REGION=us-east-1.
 */
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SqsConsumer, type EmitterLike } from "../consumer/SqsConsumer.js";
import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
export declare const LOCAL_ACCOUNT = "000000000000";
export declare const LOCAL_REGION = "us-east-1";
export declare const LOCAL_TOPIC_ARN = "arn:aws:sns:us-east-1:000000000000:aisound-local-platform-events";
export declare function localQueueUrl(consumer: string, endpoint?: string): string;
export declare const isFlociAvailable: () => boolean;
/** A minimal in-memory emitter with the same contract eventemitter2 gives the consumer. */
export declare class FakeEmitter implements EmitterLike {
    private listeners;
    on(event: string, fn: (payload: unknown) => Promise<unknown> | unknown): this;
    listenerCount(event: string): number;
    emitAsync(event: string, payload: unknown): Promise<unknown>;
}
/** Build a consumer outside the DI container. */
export declare function buildConsumer(emitter: EmitterLike, config: EventBrokerConfig): SqsConsumer;
export declare function localConfig(consumer: string, overrides?: Partial<EventBrokerConfig["sqs"]>, serviceName?: string): EventBrokerConfig;
export declare function publishTestEvent(sns: SNSClient, eventType: string, eventId: string, payload?: Record<string, unknown>): Promise<void>;
export declare function sendRawToQueue(sqs: SQSClient, queueUrl: string, body: string): Promise<void>;
export declare function queueDepth(sqs: SQSClient, queueUrl: string): Promise<number>;
export declare function visibleDepth(sqs: SQSClient, queueUrl: string): Promise<number>;
/** Peek without consuming (visibility 0 leaves the messages in place). */
export declare function peek(sqs: SQSClient, queueUrl: string, max?: number): Promise<string[]>;
export declare function purge(sqs: SQSClient, queueUrl: string): Promise<void>;
export declare function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs?: number, everyMs?: number): Promise<void>;
export declare const sleep: (ms: number) => Promise<void>;
