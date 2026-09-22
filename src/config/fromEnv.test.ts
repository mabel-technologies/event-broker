import { describe, expect, it } from "vitest";
import { EVENT_BROKER_ENV, eventBrokerConfigFromEnv } from "./fromEnv.js";

describe("eventBrokerConfigFromEnv", () => {
  it("reads the standard variables with sane defaults", () => {
    const cfg = eventBrokerConfigFromEnv({
      serviceName: "social",
      env: {
        [EVENT_BROKER_ENV.TOPIC_ARN]: "arn:topic",
        [EVENT_BROKER_ENV.QUEUE_URL]: "https://sqs/q",
        [EVENT_BROKER_ENV.ACK_ON_SUCCESS]: "true",
        [EVENT_BROKER_ENV.VISIBILITY]: "120",
        [EVENT_BROKER_ENV.IDEMPOTENCY_MODE]: "shadow",
        [EVENT_BROKER_ENV.MAX_MESSAGES]: "2",
      },
    });
    expect(cfg.region).toBe("us-east-2");
    expect(cfg.serviceName).toBe("social");
    expect(cfg.sqs).toMatchObject({ queueUrl: "https://sqs/q", enabled: true, maxMessages: 2, ackOnSuccess: true, visibilityTimeoutSeconds: 120 });
    expect(cfg.idempotency).toEqual({ mode: "shadow", leaseMs: 240_000, retentionSeconds: 14 * 86_400 });
  });

  it("defaults: flag off, mode off, visibility 30, and a legacy queue variable name can be pointed at", () => {
    const cfg = eventBrokerConfigFromEnv({ serviceName: "auth", env: { EVENT_BROKER_SQS_QUEUE_AUTH_URL: "https://sqs/auth" }, queueUrlVar: "EVENT_BROKER_SQS_QUEUE_AUTH_URL" });
    expect(cfg.sqs.queueUrl).toBe("https://sqs/auth");
    expect(cfg.sqs.ackOnSuccess).toBe(false);
    expect(cfg.sqs.visibilityTimeoutSeconds).toBe(30);
    expect(cfg.idempotency?.mode).toBe("off");
  });

  it("rejects an unknown idempotency mode and ignores non-numeric numbers", () => {
    expect(() => eventBrokerConfigFromEnv({ serviceName: "data", env: { [EVENT_BROKER_ENV.IDEMPOTENCY_MODE]: "maybe" } })).toThrow(/off \| shadow \| enforce/);
    expect(eventBrokerConfigFromEnv({ serviceName: "data", env: { [EVENT_BROKER_ENV.MAX_MESSAGES]: "ten" } }).sqs.maxMessages).toBe(10);
  });
});
