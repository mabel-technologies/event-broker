import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryableEventError } from "../errors/EventErrors.js";
import type { ClaimResult, IdempotencyStore } from "../idempotency/IdempotencyStore.js";
import { assertUniqueHandlerIds, eventBrokerDedupKey } from "../idempotency/IdempotencyStore.js";
import { setIdempotencyRuntime } from "../idempotency/runtime.js";
import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
import { OnSubscribe } from "./OnSubscribe.js";

vi.mock("@tsed/event-emitter", () => ({
  OnEvent: () => (_t: object, _k: string, d: PropertyDescriptor) => d,
}));

class MemoryStore implements IdempotencyStore {
  rows = new Map<string, { state: "inflight" | "done"; token: string; leaseUntil: number; expiresAt: number }>();
  calls: string[] = [];
  failing = false;
  async claim(key: string, token: string, leaseMs: number): Promise<ClaimResult> {
    this.calls.push(`claim:${key}`);
    if (this.failing) throw new Error("store down");
    const now = Date.now();
    const cur = this.rows.get(key);
    if (!cur || (cur.state === "inflight" && cur.leaseUntil < now)) {
      this.rows.set(key, { state: "inflight", token, leaseUntil: now + leaseMs, expiresAt: now + 86_400_000 });
      return "claimed";
    }
    return cur.state === "done" && cur.expiresAt > now ? "done" : "in_flight";
  }
  async complete(key: string, token: string, retentionSeconds: number): Promise<void> {
    this.calls.push(`complete:${key}`);
    const cur = this.rows.get(key);
    if (cur?.token === token) this.rows.set(key, { ...cur, state: "done", expiresAt: Date.now() + retentionSeconds * 1000 });
  }
  async release(key: string, token: string): Promise<void> {
    this.calls.push(`release:${key}`);
    if (this.rows.get(key)?.token === token) this.rows.delete(key);
  }
}

function runtime(mode: "off" | "shadow" | "enforce", store?: IdempotencyStore) {
  const config: EventBrokerConfig = {
    region: "us-east-1",
    serviceName: "social",
    sns: { topicArn: "" },
    sqs: { queueUrl: "q", enabled: true, visibilityTimeoutSeconds: 30 },
    idempotency: { mode, leaseMs: 1_000, retentionSeconds: 60 },
  };
  setIdempotencyRuntime({ config, store });
}

function subject(store: MemoryStore, opts: Parameters<typeof OnSubscribe>[1] = { id: "post.index" }) {
  const runs: string[] = [];
  class Listener {
    fail = false;
    @OnSubscribe("social.post.created", opts)
    async onPostCreated(payload: { eventId: string }) {
      runs.push(payload.eventId);
      if (this.fail) throw new Error("handler failed");
      return "done";
    }
  }
  return { listener: new Listener(), runs, store };
}

afterEach(() => setIdempotencyRuntime(null));

describe("@OnSubscribe idempotency", () => {
  it("mode=off runs the handler and never touches the store", async () => {
    const store = new MemoryStore();
    runtime("off", store);
    const { listener, runs } = subject(store);
    await listener.onPostCreated({ eventId: "e1" });
    await listener.onPostCreated({ eventId: "e1" });
    expect(runs).toEqual(["e1", "e1"]);
    expect(store.calls).toEqual([]);
  });

  it("mode=enforce: first delivery claims and completes; the duplicate resolves without running", async () => {
    const store = new MemoryStore();
    runtime("enforce", store);
    const { listener, runs } = subject(store);
    expect(await listener.onPostCreated({ eventId: "e1" })).toBe("done");
    expect(await listener.onPostCreated({ eventId: "e1" })).toBeUndefined();
    expect(runs).toEqual(["e1"]);
    const key = eventBrokerDedupKey("social", "e1", "post.index");
    expect(store.calls).toEqual([`claim:${key}`, `complete:${key}`, `claim:${key}`]);
  });

  it("mode=shadow: counts the duplicate but still runs the handler", async () => {
    const store = new MemoryStore();
    runtime("shadow", store);
    const { listener, runs } = subject(store);
    await listener.onPostCreated({ eventId: "e1" });
    await listener.onPostCreated({ eventId: "e1" });
    expect(runs).toEqual(["e1", "e1"]);
  });

  it("a handler failure releases the claim so the redelivery can run it again", async () => {
    const store = new MemoryStore();
    runtime("enforce", store);
    const { listener, runs } = subject(store);
    listener.fail = true;
    await expect(listener.onPostCreated({ eventId: "e1" })).rejects.toThrow("handler failed");
    listener.fail = false;
    expect(await listener.onPostCreated({ eventId: "e1" })).toBe("done");
    expect(runs).toEqual(["e1", "e1"]);
  });

  it("a live claim held elsewhere rejects (retryable) instead of resolving", async () => {
    const store = new MemoryStore();
    runtime("enforce", store);
    const { listener, runs } = subject(store);
    await store.claim(eventBrokerDedupKey("social", "e1", "post.index"), "other-pod", 60_000);
    await expect(listener.onPostCreated({ eventId: "e1" })).rejects.toBeInstanceOf(RetryableEventError);
    expect(runs).toEqual([]);
  });

  it("fails closed when the store is unreachable or missing", async () => {
    const store = new MemoryStore();
    store.failing = true;
    runtime("enforce", store);
    const { listener, runs } = subject(store);
    await expect(listener.onPostCreated({ eventId: "e1" })).rejects.toThrow(/store unavailable/);
    runtime("enforce", undefined);
    await expect(listener.onPostCreated({ eventId: "e2" })).rejects.toThrow(/no IDEMPOTENCY_STORE/);
    expect(runs).toEqual([]);
  });

  it("keys per listener: two handlers for one event each get their own marker", async () => {
    const store = new MemoryStore();
    runtime("enforce", store);
    const a = subject(store, { id: "a" });
    const b = subject(store, { id: "b" });
    await a.listener.onPostCreated({ eventId: "e1" });
    await b.listener.onPostCreated({ eventId: "e1" });
    expect([...store.rows.keys()]).toEqual([eventBrokerDedupKey("social", "e1", "a"), eventBrokerDedupKey("social", "e1", "b")]);
  });

  it("idempotent:false and payloads without eventId bypass the store; a sync throw becomes a rejection", async () => {
    const store = new MemoryStore();
    runtime("enforce", store);
    class L {
      @OnSubscribe("platform.heartbeat", { id: "hb", idempotent: false })
      async beat() {
        return 1;
      }
      @OnSubscribe("x", { id: "sync" })
      boom(): never {
        throw new Error("sync");
      }
    }
    const l = new L();
    expect(await l.beat()).toBe(1);
    await expect((l.boom as unknown as (p: unknown) => Promise<never>)({ eventId: "e1" })).rejects.toThrow("sync");
    const { listener } = subject(store);
    await listener.onPostCreated({} as { eventId: string });
    expect(store.calls.filter((c) => c.startsWith("claim:evt:social:e1"))).toHaveLength(1); // only the sync-throw handler claimed
  });
});

describe("assertUniqueHandlerIds", () => {
  it("accepts unique explicit ids and rejects duplicates and Class.method fallbacks", () => {
    expect(() => assertUniqueHandlerIds(["a.b", "c.d"])).not.toThrow();
    expect(() => assertUniqueHandlerIds(["a.b", "a.b"])).toThrow(/duplicate/);
    expect(() => assertUniqueHandlerIds(["PostCreatedListener.onPostCreated"], { forbidFallback: true })).toThrow(/fallback/);
    expect(() => assertUniqueHandlerIds([""])).toThrow(/non-empty/);
  });
});
