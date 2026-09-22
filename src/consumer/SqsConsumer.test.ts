import { ChangeMessageVisibilityCommand, DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import type { Message } from "@aws-sdk/client-sqs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NonRetryableEventError } from "../errors/EventErrors.js";
import { buildConsumer, FakeEmitter } from "../testing/index.js";
import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
import { SqsConsumer } from "./SqsConsumer.js";

const QUEUE = "http://localhost:4566/000000000000/aisound-local-platform-events_social_queue";

function config(overrides: Partial<EventBrokerConfig["sqs"]> = {}): EventBrokerConfig {
  return {
    region: "us-east-1",
    serviceName: "social",
    sns: { topicArn: "arn:aws:sns:us-east-1:000000000000:aisound-local-platform-events" },
    sqs: { queueUrl: QUEUE, enabled: true, visibilityTimeoutSeconds: 30, ...overrides },
  };
}

/** Replace the SDK client with a recorder. */
function stubClient(consumer: SqsConsumer, attrs: Record<string, string> = { QueueArn: "arn", VisibilityTimeout: "30" }) {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    calls.push({ name: cmd.constructor.name, input: cmd.input });
    if (cmd instanceof GetQueueAttributesCommand) return { Attributes: attrs };
    if (cmd instanceof ReceiveMessageCommand) return { Messages: [] };
    return {};
  });
  (consumer as unknown as { client: { send: typeof send } }).client = { send };
  return { calls, send };
}

function msg(body: unknown, receiveCount = 1, id = "m1"): Message {
  return {
    MessageId: id,
    ReceiptHandle: `rh-${id}`,
    Body: typeof body === "string" ? body : JSON.stringify(body),
    Attributes: { ApproximateReceiveCount: String(receiveCount) },
  };
}

const envelope = (eventType: string, eventId = "evt-1", payload: Record<string, unknown> = { userId: "u1" }) => ({
  eventType,
  event_id: eventId,
  payload,
});

describe("SqsConsumer — ackOnSuccess=false (legacy path)", () => {
  let emitter: FakeEmitter;
  beforeEach(() => {
    emitter = new FakeEmitter();
  });

  it("deletes the message whether the handler succeeds or throws", async () => {
    const seen: string[] = [];
    emitter.on("user.login", async (p) => {
      seen.push((p as { eventId: string }).eventId);
    });
    emitter.on("user.signup", async () => {
      throw new Error("boom");
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: false }));
    const { calls } = stubClient(consumer);

    await consumer.handleMessage(msg(envelope("user.login", "e1")));
    await consumer.handleMessage(msg(envelope("user.signup", "e2"), 1, "m2"));

    expect(seen).toEqual(["e1"]);
    expect(calls.filter((c) => c.name === "DeleteMessageCommand").map((c) => c.input.ReceiptHandle)).toEqual(["rh-m1", "rh-m2"]);
    expect(calls.some((c) => c.name === "ChangeMessageVisibilityCommand")).toBe(false);
  });

  it("still deletes malformed and no-listener messages (shadow), never touching visibility", async () => {
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: false }));
    const { calls } = stubClient(consumer);
    await consumer.handleMessage(msg("not json"));
    await consumer.handleMessage(msg({ payload: {} }, 1, "m2")); // missing eventType
    await consumer.handleMessage(msg(envelope("nobody.listens"), 1, "m3"));
    expect(calls.filter((c) => c.name === "DeleteMessageCommand")).toHaveLength(3);
    expect(calls.some((c) => c.name === "ChangeMessageVisibilityCommand")).toBe(false);
  });
});

describe("SqsConsumer — ackOnSuccess=true", () => {
  let emitter: FakeEmitter;
  beforeEach(() => {
    emitter = new FakeEmitter();
  });

  it("acks only after every listener resolved", async () => {
    const order: string[] = [];
    emitter.on("user.login", async () => {
      order.push("a");
    });
    emitter.on("user.login", async () => {
      order.push("b");
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true }));
    const { calls } = stubClient(consumer);
    await consumer.handleMessage(msg(envelope("user.login")));
    expect(order).toEqual(["a", "b"]);
    expect(calls.map((c) => c.name)).toEqual(["DeleteMessageCommand"]);
  });

  it("leaves a failing message on the queue with exponential, jittered backoff", async () => {
    emitter.on("user.login", async () => {
      throw new Error("db timeout");
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true, retryBaseSeconds: 10 }));
    const { calls } = stubClient(consumer);
    await consumer.handleMessage(msg(envelope("user.login"), 1));
    await consumer.handleMessage(msg(envelope("user.login"), 3, "m2"));
    const vis = calls.filter((c) => c.name === "ChangeMessageVisibilityCommand").map((c) => Number(c.input.VisibilityTimeout));
    expect(calls.some((c) => c.name === "DeleteMessageCommand")).toBe(false);
    expect(vis).toHaveLength(2);
    expect(vis[0]).toBeGreaterThanOrEqual(5); // 10s × [0.5, 1)
    expect(vis[0]).toBeLessThanOrEqual(10);
    expect(vis[1]).toBeGreaterThanOrEqual(20); // 40s × [0.5, 1)
    expect(vis[1]).toBeLessThanOrEqual(40);
  });

  it("caps the backoff at 900s", async () => {
    emitter.on("user.login", async () => {
      throw new Error("still failing");
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true }));
    const { calls } = stubClient(consumer);
    await consumer.handleMessage(msg(envelope("user.login"), 50));
    const vis = Number(calls.find((c) => c.name === "ChangeMessageVisibilityCommand")?.input.VisibilityTimeout);
    expect(vis).toBeLessThanOrEqual(900);
    expect(vis).toBeGreaterThanOrEqual(450);
  });

  it("routes NonRetryableEventError, no-listener and malformed messages to the DLQ via visibility 0, never SendMessage", async () => {
    emitter.on("user.login", async () => {
      throw new NonRetryableEventError("bad payload");
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true }));
    const { calls } = stubClient(consumer);
    await consumer.handleMessage(msg(envelope("user.login")));
    await consumer.handleMessage(msg(envelope("nobody.listens"), 1, "m2"));
    await consumer.handleMessage(msg("{not json", 1, "m3"));
    await consumer.handleMessage(msg("", 1, "m4"));
    const names = calls.map((c) => c.name);
    expect(names.filter((n) => n === "ChangeMessageVisibilityCommand")).toHaveLength(4); // poison, no listener, bad JSON, empty body
    expect(calls.filter((c) => c.name === "ChangeMessageVisibilityCommand").every((c) => c.input.VisibilityTimeout === 0)).toBe(true);
    expect(names).not.toContain("DeleteMessageCommand");
    expect(names).not.toContain("SendMessageCommand");
  });

  it("unwraps an SNS Notification envelope and injects eventId into the payload", async () => {
    let received: unknown;
    emitter.on("social.post.created", async (p) => {
      received = p;
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true }));
    stubClient(consumer);
    const sns = { Type: "Notification", TopicArn: "arn", Message: JSON.stringify(envelope("social.post.created", "e9", { postId: "p1" })) };
    await consumer.handleMessage(msg(sns));
    expect(received).toEqual({ postId: "p1", eventId: "e9" });
  });

  it("extends the lease while a slow handler runs", async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      emitter.on("user.login", () => new Promise<void>((r) => (release = r)));
      const consumer = buildConsumer(emitter, config({ ackOnSuccess: true, visibilityTimeoutSeconds: 20 }));
      const { calls } = stubClient(consumer);
      const run = consumer.handleMessage(msg(envelope("user.login")));
      await vi.advanceTimersByTimeAsync(25_000); // two extensions at 10s intervals
      release();
      await run;
      const extends_ = calls.filter((c) => c.name === "ChangeMessageVisibilityCommand" && c.input.VisibilityTimeout === 20);
      expect(extends_.length).toBeGreaterThanOrEqual(2);
      expect(calls.at(-1)?.name).toBe("DeleteMessageCommand");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SqsConsumer — assertReady", () => {
  it("refuses ackOnSuccess on a queue without a RedrivePolicy", async () => {
    const consumer = buildConsumer(new FakeEmitter(), config({ ackOnSuccess: true }));
    stubClient(consumer, { QueueArn: "arn", VisibilityTimeout: "30" });
    await expect(consumer.assertReady()).rejects.toThrow(/RedrivePolicy/);
  });

  it("accepts ackOnSuccess when a RedrivePolicy exists, and fails on an empty queue URL", async () => {
    const ok = buildConsumer(new FakeEmitter(), config({ ackOnSuccess: true }));
    stubClient(ok, { QueueArn: "arn", VisibilityTimeout: "30", RedrivePolicy: '{"maxReceiveCount":"5"}' });
    await expect(ok.assertReady()).resolves.toBeUndefined();

    const empty = buildConsumer(new FakeEmitter(), config({ queueUrl: "" }));
    stubClient(empty);
    await expect(empty.assertReady()).rejects.toThrow(/queueUrl is empty/);
  });
});

describe("SqsConsumer — poll loop and drain", () => {
  it("isolates a throwing message from its batch-mates and backs off on receive errors", async () => {
    const emitter = new FakeEmitter();
    const handled: string[] = [];
    emitter.on("user.login", async (p) => {
      const id = (p as { eventId: string }).eventId;
      if (id === "bad") throw new Error("boom");
      handled.push(id);
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true, pollingWaitTimeSeconds: 0 }));
    let receives = 0;
    const calls: string[] = [];
    (consumer as unknown as { client: { send: unknown } }).client = {
      send: async (cmd: { constructor: { name: string } }) => {
        calls.push(cmd.constructor.name);
        if (cmd instanceof ReceiveMessageCommand) {
          receives++;
          if (receives === 1) return { Messages: [msg(envelope("user.login", "ok1"), 1, "a"), msg(envelope("user.login", "bad"), 1, "b"), msg(envelope("user.login", "ok2"), 1, "c")] };
          if (receives === 2) throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
          return { Messages: [] };
        }
        return {};
      },
    };
    consumer.start();
    await new Promise((r) => setTimeout(r, 300));
    await consumer.stop();
    expect(handled).toEqual(["ok1", "ok2"]);
    expect(calls.filter((c) => c === "DeleteMessageCommand")).toHaveLength(2);
    expect(calls.filter((c) => c === "ChangeMessageVisibilityCommand")).toHaveLength(1);
    expect((consumer as unknown as { receiveBackoffMs: number }).receiveBackoffMs).toBeGreaterThanOrEqual(1_000);
  });

  it("a batch received after stop() was called is released with visibility 0, not handled", async () => {
    const emitter = new FakeEmitter();
    const handled: string[] = [];
    emitter.on("user.login", async (p) => {
      handled.push((p as { eventId: string }).eventId);
    });
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true, pollingWaitTimeSeconds: 1 }));
    let resolveReceive!: (v: unknown) => void;
    const visibility: number[] = [];
    const names: string[] = [];
    (consumer as unknown as { client: { send: unknown } }).client = {
      send: async (cmd: { constructor: { name: string }; input: { VisibilityTimeout?: number } }) => {
        names.push(cmd.constructor.name);
        if (cmd instanceof ReceiveMessageCommand) return new Promise((r) => (resolveReceive = r)); // never resolves on its own
        if (cmd instanceof ChangeMessageVisibilityCommand) visibility.push(cmd.input.VisibilityTimeout ?? -1);
        return {};
      },
    };
    consumer.start();
    await new Promise((r) => setTimeout(r, 20));
    const stopping = consumer.stop();
    resolveReceive({ Messages: [msg(envelope("user.login", "late"))] }); // the receive completes after stop() began
    await stopping;
    expect(handled).toEqual([]);
    expect(visibility).toEqual([0]);
    expect(names).not.toContain("DeleteMessageCommand");
  });

  it("stop() waits for an in-flight handler up to the drain cap, then releases the message with visibility 0", async () => {
    const emitter = new FakeEmitter();
    emitter.on("user.login", () => new Promise<void>((r) => setTimeout(r, 2_000))); // longer than the cap below
    const consumer = buildConsumer(emitter, config({ ackOnSuccess: true, drainTimeoutMs: 200, pollingWaitTimeSeconds: 0 }));
    let receives = 0;
    const visibility: number[] = [];
    (consumer as unknown as { client: { send: unknown } }).client = {
      send: async (cmd: { constructor: { name: string }; input: { VisibilityTimeout?: number } }) => {
        if (cmd instanceof ReceiveMessageCommand) return ++receives === 1 ? { Messages: [msg(envelope("user.login"))] } : { Messages: [] };
        if (cmd instanceof ChangeMessageVisibilityCommand) visibility.push(cmd.input.VisibilityTimeout ?? -1);
        return {};
      },
    };
    consumer.start();
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await consumer.stop();
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(visibility).toContain(0);
  });
});
