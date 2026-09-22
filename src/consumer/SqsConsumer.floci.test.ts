/**
 * Integration against the local Floci stack. Runs only when AWS_ENDPOINT_URL is set:
 *   npm run local:up && LOCAL_MAX_RECEIVE_COUNT=2 npm run local:up   (faster dead-lettering)
 *   npm run test:floci
 */
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NonRetryableEventError } from "../errors/EventErrors.js";
import {
  FakeEmitter,
  buildConsumer,
  isFlociAvailable,
  localConfig,
  localQueueUrl,
  publishTestEvent,
  sendRawToQueue,
  sleep,
  visibleDepth,
  waitFor,
} from "../testing/index.js";

// The music queue: nothing in the local stack (.local/services/run.sh) polls it, so a locally
// running social-be cannot eat the test messages. music.playlist.created is in its filter policy.
const CONSUMER = "music";
const EVENT = "music.playlist.created";
const QUEUE = localQueueUrl(CONSUMER);
const DLQ = `${QUEUE}_dlq`;

describe.skipIf(!isFlociAvailable())("SqsConsumer against Floci", () => {
  const sns = new SNSClient({ region: "us-east-1" });
  const sqs = new SQSClient({ region: "us-east-1" });
  const stop: Array<() => Promise<void>> = [];

  // No PurgeQueue here: SQS (and Floci) discard messages sent within ~60 s after a purge, which
  // silently empties every test that follows. Assert on deltas instead.
  let dlqBefore = 0;
  beforeEach(async () => {
    dlqBefore = await visibleDepth(sqs, DLQ);
  });
  afterEach(async () => {
    for (const s of stop.splice(0)) await s();
  });

  it("flag off: a throwing handler still deletes the message and the DLQ stays empty", async () => {
    const emitter = new FakeEmitter().on(EVENT, async () => {
      throw new Error("boom");
    });
    const consumer = buildConsumer(emitter, localConfig(CONSUMER, { ackOnSuccess: false }));
    stop.push(() => consumer.stop());
    consumer.start();
    await publishTestEvent(sns, EVENT, `off-${Date.now()}`);
    await waitFor(async () => (await visibleDepth(sqs, QUEUE)) === 0, 20_000);
    await sleep(3_000);
    expect(await visibleDepth(sqs, DLQ)).toBe(dlqBefore);
  });

  it("flag on: success is acked, and a message received by the consumer is not in the DLQ", async () => {
    const seen: string[] = [];
    const emitter = new FakeEmitter().on(EVENT, async (p) => {
      seen.push((p as { eventId: string }).eventId);
    });
    const consumer = buildConsumer(emitter, localConfig(CONSUMER, { ackOnSuccess: true }));
    stop.push(() => consumer.stop());
    consumer.start();
    const id = `ok-${Date.now()}`;
    await publishTestEvent(sns, EVENT, id);
    await waitFor(() => seen.includes(id), 60_000); // Floci can delay SNS→SQS delivery for a while after a burst of visibility-0 rejections
    await waitFor(async () => (await visibleDepth(sqs, QUEUE)) === 0, 20_000);
    expect(await visibleDepth(sqs, DLQ)).toBe(dlqBefore);
  });

  it("flag on: handler throws → redelivered with backoff → dead-lettered by the queue's redrive policy", async () => {
    let attempts = 0;
    const emitter = new FakeEmitter().on(EVENT, async () => {
      attempts++;
      throw new Error("boom");
    });
    const consumer = buildConsumer(emitter, localConfig(CONSUMER, { ackOnSuccess: true, retryBaseSeconds: 1 }));
    stop.push(() => consumer.stop());
    consumer.start();
    await publishTestEvent(sns, EVENT, `on-${Date.now()}`);
    await waitFor(async () => (await visibleDepth(sqs, DLQ)) >= dlqBefore + 1, 80_000);
    expect(attempts).toBeGreaterThanOrEqual(2); // Floci dead-letters a little earlier than maxReceiveCount; AWS moves it on receive #6
  });

  it("flag on: poison (NonRetryableEventError) and no-listener messages reach the DLQ without a SendMessage", async () => {
    const emitter = new FakeEmitter().on(EVENT, async () => {
      throw new NonRetryableEventError("bad payload");
    });
    const consumer = buildConsumer(emitter, localConfig(CONSUMER, { ackOnSuccess: true }));
    stop.push(() => consumer.stop());
    consumer.start();
    await publishTestEvent(sns, EVENT, `poison-${Date.now()}`);
    await sendRawToQueue(sqs, QUEUE, "not json at all");
    await waitFor(async () => (await visibleDepth(sqs, DLQ)) >= dlqBefore + 2, 80_000);
  });
});
