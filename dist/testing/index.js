/**
 * Helpers for integration tests against the local Floci stack (`npm run local:up` in
 * event-broker). Point the AWS SDK at it with AWS_ENDPOINT_URL=http://localhost:4566,
 * AWS_ACCESS_KEY_ID=test, AWS_SECRET_ACCESS_KEY=test, AWS_DEFAULT_REGION=us-east-1.
 */
import { PublishCommand } from "@aws-sdk/client-sns";
import { GetQueueAttributesCommand, ReceiveMessageCommand, PurgeQueueCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SqsConsumer } from "../consumer/SqsConsumer.js";
export const LOCAL_ACCOUNT = "000000000000";
export const LOCAL_REGION = "us-east-1";
export const LOCAL_TOPIC_ARN = `arn:aws:sns:${LOCAL_REGION}:${LOCAL_ACCOUNT}:aisound-local-platform-events`;
export function localQueueUrl(consumer, endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566") {
    return `${endpoint}/${LOCAL_ACCOUNT}/aisound-local-platform-events_${consumer}_queue`;
}
export const isFlociAvailable = () => Boolean(process.env.AWS_ENDPOINT_URL);
/** A minimal in-memory emitter with the same contract eventemitter2 gives the consumer. */
export class FakeEmitter {
    constructor() {
        this.listeners = new Map();
    }
    on(event, fn) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
        return this;
    }
    listenerCount(event) {
        return this.listeners.get(event)?.length ?? 0;
    }
    async emitAsync(event, payload) {
        return Promise.all((this.listeners.get(event) ?? []).map((fn) => fn(payload)));
    }
}
/** Build a consumer outside the DI container. */
export function buildConsumer(emitter, config) {
    const settings = { get: (key) => (key === "eventBroker" ? config : undefined) };
    return new SqsConsumer(emitter, settings);
}
export function localConfig(consumer, overrides = {}, serviceName = consumer) {
    return {
        region: LOCAL_REGION,
        serviceName,
        sns: { topicArn: LOCAL_TOPIC_ARN },
        sqs: { queueUrl: localQueueUrl(consumer), enabled: true, maxMessages: 10, pollingWaitTimeSeconds: 1, visibilityTimeoutSeconds: 30, ...overrides },
    };
}
export async function publishTestEvent(sns, eventType, eventId, payload = {}) {
    await sns.send(new PublishCommand({
        TopicArn: LOCAL_TOPIC_ARN,
        Message: JSON.stringify({ eventType, event_id: eventId, payload: { ...payload, eventId } }),
        MessageAttributes: { eventType: { DataType: "String", StringValue: eventType } },
    }));
}
export async function sendRawToQueue(sqs, queueUrl, body) {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
}
export async function queueDepth(sqs, queueUrl) {
    const r = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"] }));
    return Number(r.Attributes?.ApproximateNumberOfMessages ?? 0) + Number(r.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
}
export async function visibleDepth(sqs, queueUrl) {
    const r = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["ApproximateNumberOfMessages"] }));
    return Number(r.Attributes?.ApproximateNumberOfMessages ?? 0);
}
/** Peek without consuming (visibility 0 leaves the messages in place). */
export async function peek(sqs, queueUrl, max = 10) {
    const r = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: max, VisibilityTimeout: 0, WaitTimeSeconds: 0 }));
    return (r.Messages ?? []).map((m) => m.Body ?? "");
}
export async function purge(sqs, queueUrl) {
    await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
}
export async function waitFor(predicate, timeoutMs = 30000, everyMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate())
            return;
        await new Promise((r) => setTimeout(r, everyMs));
    }
    throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
