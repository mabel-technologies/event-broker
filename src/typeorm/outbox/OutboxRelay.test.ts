import { describe, expect, it } from "vitest";
import { OutboxRelay } from "./OutboxRelay.js";
import type { OutboxRepo, OutboxRow } from "./OutboxRepo.js";

function memoryRepo(rows: Array<Partial<OutboxRow> & { id: string }>): OutboxRepo & { state: Map<string, string>; attempts: Map<string, number> } {
  const state = new Map(rows.map((r) => [r.id, "PENDING"]));
  const attempts = new Map(rows.map((r) => [r.id, r.attemptCount ?? 0]));
  return {
    state,
    attempts,
    async claimBatch({ limit }) {
      return rows
        .filter((r) => state.get(r.id) === "PENDING")
        .slice(0, limit)
        .map((r) => ({ id: r.id, eventId: r.eventId ?? r.id, eventName: r.eventName ?? "x.y", payload: r.payload ?? { eventId: r.eventId ?? r.id }, attemptCount: attempts.get(r.id)! }));
    },
    async markPublished(id) {
      state.set(id, "PUBLISHED");
    },
    async recordAttemptFailure(id) {
      attempts.set(id, attempts.get(id)! + 1);
    },
    async markDead(id) {
      state.set(id, "DEAD");
    },
    async oldestPendingAgeMs() {
      return 0;
    },
    async deadCount() {
      return [...state.values()].filter((s) => s === "DEAD").length;
    },
  };
}

describe("OutboxRelay", () => {
  it("publishes pending rows with their stored eventId and marks them", async () => {
    const repo = memoryRepo([{ id: "a", eventId: "e-a" }, { id: "b", eventId: "e-b" }]);
    const published: string[] = [];
    const relay = new OutboxRelay(repo, async (_n, p) => {
      published.push(p.eventId);
    });
    const r = await relay.runOnce();
    expect(published).toEqual(["e-a", "e-b"]);
    expect(r).toMatchObject({ claimed: 2, published: 2, failed: 0, dead: 0 });
    expect([...repo.state.values()]).toEqual(["PUBLISHED", "PUBLISHED"]);
  });

  it("a failing publish stays PENDING with a higher attempt count, and dies after maxAttempts", async () => {
    const repo = memoryRepo([{ id: "a", attemptCount: 0 }, { id: "b", attemptCount: 9 }]);
    const relay = new OutboxRelay(
      repo,
      async () => {
        throw new Error("sns down");
      },
      { maxAttempts: 10 },
    );
    const r = await relay.runOnce();
    expect(r).toMatchObject({ failed: 1, dead: 1 });
    expect(repo.state.get("a")).toBe("PENDING");
    expect(repo.attempts.get("a")).toBe(1);
    expect(repo.state.get("b")).toBe("DEAD");
  });
});
