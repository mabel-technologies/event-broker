import type { Message } from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NonRetryableEventError } from "../errors/NonRetryableEventError.js";

const { sendMock, SQSClientMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const SQSClientMock = vi.fn().mockImplementation(() => ({ send: sendMock }));
  return { sendMock, SQSClientMock };
});

vi.mock("@aws-sdk/client-sqs", () => {
  class FakeCommand<T = unknown> {
    input: T;
    constructor(input: T) {
      this.input = input;
    }
  }
  class ReceiveMessageCommand extends FakeCommand {
    readonly _cmd = "receive";
  }
  class DeleteMessageCommand extends FakeCommand {
    readonly _cmd = "delete";
  }
  class ChangeMessageVisibilityCommand extends FakeCommand {
    readonly _cmd = "changeVisibility";
  }
  class GetQueueAttributesCommand extends FakeCommand {
    readonly _cmd = "getAttrs";
  }
  return {
    SQSClient: SQSClientMock,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    ChangeMessageVisibilityCommand,
    GetQueueAttributesCommand,
  };
});

const { SqsConsumer } = await import("./SqsConsumer.js");

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    MessageId: "msg-1",
    ReceiptHandle: "receipt-1",
    Body: JSON.stringify({ eventType: "user.login", event_id: "evt-1", payload: { userId: "u1" } }),
    Attributes: { ApproximateReceiveCount: "1" },
    ...overrides,
  };
}

function makeConsumer(opts: { ackOnSuccess?: boolean } = {}) {
  const eventEmitter = { listenerCount: vi.fn().mockReturnValue(1), emitAsync: vi.fn().mockResolvedValue([]) };
  const config = {
    get: vi.fn().mockReturnValue({
      region: "us-east-1",
      sns: { topicArn: "arn:aws:sns:us-east-1:000000000000:topic" },
      sqs: {
        queueUrl: "http://localhost:4566/000000000000/test_queue",
        enabled: true,
        ackOnSuccess: opts.ackOnSuccess ?? false,
      },
    }),
  };
  const consumer = new SqsConsumer(eventEmitter as never, config as never);
  return { consumer, eventEmitter };
}

function cmdsOfType(type: string) {
  return sendMock.mock.calls.map((call) => call[0]).filter((cmd) => cmd._cmd === type);
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
});

describe("SqsConsumer — ackOnSuccess=false (legacy, unchanged behaviour)", () => {
  it("still deletes when the handler throws — ships dark until the flag is set", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: false });
    eventEmitter.emitAsync.mockRejectedValue(new Error("boom"));

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage(),
    );

    expect(cmdsOfType("delete")).toHaveLength(1);
    expect(cmdsOfType("changeVisibility")).toHaveLength(0);
  });

  it("still deletes a zero-listener message — legacy exact match", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: false });
    eventEmitter.listenerCount.mockReturnValue(0);

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage(),
    );

    expect(cmdsOfType("delete")).toHaveLength(1);
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it("still deletes a malformed (non-JSON) message", async () => {
    const { consumer } = makeConsumer({ ackOnSuccess: false });

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Body: "not json" }),
    );

    expect(cmdsOfType("delete")).toHaveLength(1);
  });
});

describe("SqsConsumer — ackOnSuccess=true", () => {
  it("deletes on handler success", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage(),
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith("user.login", expect.objectContaining({ userId: "u1" }));
    expect(cmdsOfType("delete")).toHaveLength(1);
  });

  it("backs off (does not delete) on a generic handler error", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    eventEmitter.emitAsync.mockRejectedValue(new Error("transient"));

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Attributes: { ApproximateReceiveCount: "1" } }),
    );

    expect(cmdsOfType("delete")).toHaveLength(0);
    const backoffCalls = cmdsOfType("changeVisibility");
    expect(backoffCalls).toHaveLength(1);
    const timeout = (backoffCalls[0].input as { VisibilityTimeout: number }).VisibilityTimeout;
    expect(timeout).toBeGreaterThanOrEqual(5); // 10s floor, jittered 50-100%
    expect(timeout).toBeLessThanOrEqual(10);
  });

  it("caps backoff at 900s regardless of how high receiveCount climbs", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    eventEmitter.emitAsync.mockRejectedValue(new Error("still failing"));

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Attributes: { ApproximateReceiveCount: "20" } }),
    );

    const timeout = (cmdsOfType("changeVisibility")[0].input as { VisibilityTimeout: number }).VisibilityTimeout;
    expect(timeout).toBeLessThanOrEqual(900);
    expect(timeout).toBeGreaterThanOrEqual(450);
  });

  it("routes NonRetryableEventError straight to the DLQ path (visibility 0), not backoff", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    eventEmitter.emitAsync.mockRejectedValue(new NonRetryableEventError("bad payload, will never succeed"));

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage(),
    );

    expect(cmdsOfType("delete")).toHaveLength(0);
    const rejectCalls = cmdsOfType("changeVisibility");
    expect(rejectCalls).toHaveLength(1);
    expect((rejectCalls[0].input as { VisibilityTimeout: number }).VisibilityTimeout).toBe(0);
  });

  it("rejects (visibility 0) a zero-listener message instead of deleting it", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    eventEmitter.listenerCount.mockReturnValue(0);

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage(),
    );

    expect(cmdsOfType("delete")).toHaveLength(0);
    expect((cmdsOfType("changeVisibility")[0].input as { VisibilityTimeout: number }).VisibilityTimeout).toBe(0);
  });

  it("rejects a message with no Body instead of deleting it", async () => {
    const { consumer } = makeConsumer({ ackOnSuccess: true });

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Body: undefined }),
    );

    expect(cmdsOfType("delete")).toHaveLength(0);
    expect(cmdsOfType("changeVisibility")).toHaveLength(1);
  });

  it("rejects invalid JSON instead of deleting it", async () => {
    const { consumer } = makeConsumer({ ackOnSuccess: true });

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Body: "{not valid" }),
    );

    expect(cmdsOfType("delete")).toHaveLength(0);
    expect(cmdsOfType("changeVisibility")).toHaveLength(1);
  });

  it("rejects a message missing eventType instead of deleting it", async () => {
    const { consumer } = makeConsumer({ ackOnSuccess: true });

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Body: JSON.stringify({ event_id: "evt-1", payload: {} }) }),
    );

    expect(cmdsOfType("delete")).toHaveLength(0);
    expect(cmdsOfType("changeVisibility")).toHaveLength(1);
  });

  it("unwraps an SNS Notification envelope the same way as a raw body", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    const snsWrapped = JSON.stringify({
      Type: "Notification",
      TopicArn: "arn:aws:sns:us-east-1:000000000000:topic",
      Message: JSON.stringify({ eventType: "user.login", event_id: "evt-2", payload: { userId: "u2" } }),
    });

    await (consumer as never as { processMessage: (m: Message) => Promise<void> }).processMessage(
      makeMessage({ Body: snsWrapped }),
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith("user.login", expect.objectContaining({ userId: "u2" }));
    expect(cmdsOfType("delete")).toHaveLength(1);
  });
});

describe("SqsConsumer — batch isolation (EA-F-06)", () => {
  it("a throw on one message does not stop the rest of the batch from being processed", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    eventEmitter.emitAsync.mockRejectedValueOnce(new Error("first one fails")).mockResolvedValue([]);

    sendMock.mockImplementation((cmd: { _cmd: string }) => {
      if (cmd._cmd === "receive") {
        return Promise.resolve({
          Messages: [
            makeMessage({ MessageId: "m1", ReceiptHandle: "r1" }),
            makeMessage({ MessageId: "m2", ReceiptHandle: "r2" }),
          ],
        });
      }
      return Promise.resolve({});
    });

    const c = consumer as never as { polling: boolean; poll: () => Promise<void> };
    c.polling = true;
    await c.poll();

    // second message still reached the handler and got deleted despite the first one throwing
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(2);
    expect(cmdsOfType("delete")).toHaveLength(1);
    expect(cmdsOfType("changeVisibility")).toHaveLength(1);

    await consumer.stop(); // clears the timer poll() scheduled for its next cycle
  });
});

describe("SqsConsumer — receive-loop backoff (EA-F-13)", () => {
  it("grows the receive backoff on failure and resets it on the next success", async () => {
    const { consumer } = makeConsumer();
    const c = consumer as never as { polling: boolean; receiveBackoffMs: number; poll: () => Promise<void> };
    c.polling = true;

    sendMock.mockRejectedValueOnce(new Error("throttled"));
    await c.poll();
    expect(c.receiveBackoffMs).toBeGreaterThan(0);

    sendMock.mockResolvedValueOnce({ Messages: [] });
    await c.poll();
    expect(c.receiveBackoffMs).toBe(0);

    await consumer.stop();
  });
});

describe("SqsConsumer — graceful drain (EA-F-11)", () => {
  it("stop() waits for in-flight processing before returning", async () => {
    const { consumer, eventEmitter } = makeConsumer({ ackOnSuccess: true });
    let resolveHandler!: () => void;
    eventEmitter.emitAsync.mockReturnValue(new Promise<void>((resolve) => (resolveHandler = resolve)));

    const c = consumer as never as {
      inFlight: Set<Promise<unknown>>;
      processMessage: (m: Message) => Promise<void>;
      stop: () => Promise<void>;
    };

    const processing = c.processMessage(makeMessage());
    c.inFlight.add(processing);
    expect(c.inFlight.size).toBe(1);

    let stopped = false;
    const stopPromise = c.stop().then(() => {
      stopped = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false); // still draining

    resolveHandler();
    await processing;
    await stopPromise;
    expect(stopped).toBe(true);
  });
});

describe("SqsConsumer — startup validation (EA-F-07 adjacent: fail fast, not silently)", () => {
  it("start() rejects if the queue is unreachable", async () => {
    const { consumer } = makeConsumer();
    sendMock.mockImplementation((cmd: { _cmd: string }) => {
      if (cmd._cmd === "getAttrs") {
        return Promise.reject(new Error("AWS.SimpleQueueService.NonExistentQueue"));
      }
      return Promise.resolve({});
    });

    await expect(consumer.start()).rejects.toThrow(/unreachable/);
  });

  it("start() succeeds and begins polling once the queue is reachable", async () => {
    const { consumer } = makeConsumer();
    sendMock.mockResolvedValue({ Messages: [] });

    await expect(consumer.start()).resolves.toBeUndefined();
    await consumer.stop();
  });
});
