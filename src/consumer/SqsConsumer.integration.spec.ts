// Real integration test against a local Floci stack (see ../../.local/README.md). Exercises the
// actual AWS wire behaviour (visibility timeouts, redrive to a real DLQ, ApproximateReceiveCount)
// that the unit tests in SqsConsumer.spec.ts mock away. Skips itself if Floci isn't reachable.
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { EventEmitterService } from "@tsed/event-emitter";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NonRetryableEventError } from "../errors/NonRetryableEventError.js";
import { SqsConsumer } from "./SqsConsumer.js";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.AWS_DEFAULT_REGION ??= "us-east-1";
process.env.AWS_ENDPOINT_URL ??= ENDPOINT;

async function isFlociUp(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/_localstack/health`);
    return res.ok;
  } catch {
    return false;
  }
}

const flociUp = await isFlociUp();
if (!flociUp) {
  // eslint-disable-next-line no-console
  console.warn(
    `[SqsConsumer.integration.spec] Floci not reachable at ${ENDPOINT} — skipping. Run "npm run local:up" first.`,
  );
}

describe.skipIf(!flociUp)("SqsConsumer — real Floci integration", () => {
  const rawClient = new SQSClient({ region: "us-east-1", endpoint: ENDPOINT });
  const suffix = Date.now();
  const dlqName = `sqs-consumer-it-dlq-${suffix}`;
  const queueName = `sqs-consumer-it-${suffix}`;
  let queueUrl: string;
  let dlqUrl: string;

  function makeConsumer(eventEmitter: EventEmitterService, ackOnSuccess: boolean) {
    const config = {
      get: () => ({
        region: "us-east-1",
        sns: { topicArn: "arn:aws:sns:us-east-1:000000000000:unused-in-this-test" },
        sqs: { queueUrl, enabled: true, ackOnSuccess },
      }),
    };
    return new SqsConsumer(eventEmitter as never, config as never);
  }

  function snsWrappedBody(eventType: string, eventId: string, payload: unknown): string {
    return JSON.stringify({
      Type: "Notification",
      TopicArn: "arn:aws:sns:us-east-1:000000000000:unused-in-this-test",
      Message: JSON.stringify({ eventType, event_id: eventId, payload }),
    });
  }

  beforeAll(async () => {
    const dlq = await rawClient.send(new CreateQueueCommand({ QueueName: dlqName }));
    dlqUrl = dlq.QueueUrl!;
    const dlqArn = (
      await rawClient.send(
        new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ["QueueArn"] }),
      )
    ).Attributes!.QueueArn!;

    const queue = await rawClient.send(new CreateQueueCommand({ QueueName: queueName }));
    queueUrl = queue.QueueUrl!;
    await rawClient.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: {
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 2 }),
          VisibilityTimeout: "5",
        },
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await rawClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    await rawClient.send(new DeleteQueueCommand({ QueueUrl: dlqUrl }));
  });

  beforeEach(async () => {
    // drain leftovers between tests so each starts from an empty queue/DLQ
    for (const url of [queueUrl, dlqUrl]) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { Messages } = await rawClient.send(
          new ReceiveMessageCommand({ QueueUrl: url, WaitTimeSeconds: 0, VisibilityTimeout: 0 }),
        );
        if (!Messages?.length) break;
        for (const m of Messages) {
          await rawClient.send(
            new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle! }),
          );
        }
      }
    }
  });

  it("processes a real SNS-wrapped message end to end and deletes it on success", async () => {
    const emitter = new EventEmitterService();
    emitter.on("it.success", () => undefined);
    const consumer = makeConsumer(emitter, true);

    await rawClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: snsWrappedBody("it.success", "evt-1", { hello: "world" }),
      }),
    );

    const { Messages } = await rawClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 3 }),
    );
    expect(Messages).toHaveLength(1);
    await (consumer as never as { processMessage: (m: unknown) => Promise<void> }).processMessage(
      Messages![0],
    );

    const after = await rawClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 1 }),
    );
    expect(after.Messages ?? []).toHaveLength(0); // deleted, not left behind
  });

  it("redrives to the real DLQ after maxReceiveCount NonRetryableEventError rejections", async () => {
    const emitter = new EventEmitterService();
    emitter.on("it.poison", () => {
      throw new NonRetryableEventError("will never succeed");
    });
    const consumer = makeConsumer(emitter, true);
    const processMessage = (
      consumer as never as { processMessage: (m: unknown) => Promise<void> }
    ).processMessage.bind(consumer);

    await rawClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: snsWrappedBody("it.poison", "evt-2", {}),
      }),
    );

    // maxReceiveCount=2 on this queue: two rejections (visibility -> 0, immediately redeliverable)
    // should be enough for Floci to move it to the DLQ on the next receive.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { Messages } = await rawClient.send(
        new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 3 }),
      );
      expect(Messages).toHaveLength(1);
      await processMessage(Messages![0]);
    }

    const sourceAfter = await rawClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 2 }),
    );
    expect(sourceAfter.Messages ?? []).toHaveLength(0);

    const dlqAfter = await rawClient.send(
      new ReceiveMessageCommand({ QueueUrl: dlqUrl, WaitTimeSeconds: 5 }),
    );
    expect(dlqAfter.Messages).toHaveLength(1);
    const dlqBody = JSON.parse(dlqAfter.Messages![0].Body!);
    expect(dlqBody.Message).toContain("evt-2");
  }, 20_000);

  it("rejects a zero-listener message (visibility 0, immediately re-receivable) instead of deleting it", async () => {
    const emitter = new EventEmitterService(); // nothing registered for it.orphaned
    const consumer = makeConsumer(emitter, true);

    await rawClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: snsWrappedBody("it.orphaned", "evt-3", {}),
      }),
    );

    const { Messages } = await rawClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 3 }),
    );
    expect(Messages).toHaveLength(1);
    await (consumer as never as { processMessage: (m: unknown) => Promise<void> }).processMessage(
      Messages![0],
    );

    // visibility was set to 0, so it's immediately receivable again rather than gone
    const again = await rawClient.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 3 }),
    );
    expect(again.Messages).toHaveLength(1);
  });
});
