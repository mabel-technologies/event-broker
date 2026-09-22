/**
 * Helpers for integration tests against the local Floci stack (`npm run local:up` in
 * event-broker). Point the AWS SDK at it with AWS_ENDPOINT_URL=http://localhost:4566,
 * AWS_ACCESS_KEY_ID=test, AWS_SECRET_ACCESS_KEY=test, AWS_DEFAULT_REGION=us-east-1.
 */
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SQSClient, GetQueueAttributesCommand, ReceiveMessageCommand, PurgeQueueCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { DIConfiguration } from "@tsed/di";
import { SqsConsumer, type EmitterLike } from "../consumer/SqsConsumer.js";
import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";

export const LOCAL_ACCOUNT = "000000000000";
export const LOCAL_REGION = "us-east-1";
export const LOCAL_TOPIC_ARN = `arn:aws:sns:${LOCAL_REGION}:${LOCAL_ACCOUNT}:aisound-local-platform-events`;

export function localQueueUrl(consumer: string, endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566"): string {
  return `${endpoint}/${LOCAL_ACCOUNT}/aisound-local-platform-events_${consumer}_queue`;
}

export const isFlociAvailable = (): boolean => Boolean(process.env.AWS_ENDPOINT_URL);

/** A minimal in-memory emitter with the same contract eventemitter2 gives the consumer. */
export class FakeEmitter implements EmitterLike {
  private listeners = new Map<string, Array<(payload: unknown) => Promise<unknown> | unknown>>();
  on(event: string, fn: (payload: unknown) => Promise<unknown> | unknown): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
  async emitAsync(event: string, payload: unknown): Promise<unknown> {
    return Promise.all((this.listeners.get(event) ?? []).map((fn) => fn(payload)));
  }
}

/** Build a consumer outside the DI container. */
export function buildConsumer(emitter: EmitterLike, config: EventBrokerConfig): SqsConsumer {
  const settings = { get: (key: string) => (key === "eventBroker" ? config : undefined) } as unknown as DIConfiguration;
  return new SqsConsumer(emitter, settings);
}

export function localConfig(consumer: string, overrides: Partial<EventBrokerConfig["sqs"]> = {}, serviceName = consumer): EventBrokerConfig {
  return {
    region: LOCAL_REGION,
    serviceName,
    sns: { topicArn: LOCAL_TOPIC_ARN },
    sqs: { queueUrl: localQueueUrl(consumer), enabled: true, maxMessages: 10, pollingWaitTimeSeconds: 1, visibilityTimeoutSeconds: 30, ...overrides },
  };
}

export async function publishTestEvent(sns: SNSClient, eventType: string, eventId: string, payload: Record<string, unknown> = {}): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: LOCAL_TOPIC_ARN,
      Message: JSON.stringify({ eventType, event_id: eventId, payload: { ...payload, eventId } }),
      MessageAttributes: { eventType: { DataType: "String", StringValue: eventType } },
    }),
  );
}

export async function sendRawToQueue(sqs: SQSClient, queueUrl: string, body: string): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
}

export async function queueDepth(sqs: SQSClient, queueUrl: string): Promise<number> {
  const r = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"] }),
  );
  return Number(r.Attributes?.ApproximateNumberOfMessages ?? 0) + Number(r.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
}

export async function visibleDepth(sqs: SQSClient, queueUrl: string): Promise<number> {
  const r = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["ApproximateNumberOfMessages"] }));
  return Number(r.Attributes?.ApproximateNumberOfMessages ?? 0);
}

/** Peek without consuming (visibility 0 leaves the messages in place). */
export async function peek(sqs: SQSClient, queueUrl: string, max = 10): Promise<string[]> {
  const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: max, VisibilityTimeout: 0, WaitTimeSeconds: 0 }));
  return (r.Messages ?? []).map((m) => m.Body ?? "");
}

export async function purge(sqs: SQSClient, queueUrl: string): Promise<void> {
  await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
}

export async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 30_000, everyMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
