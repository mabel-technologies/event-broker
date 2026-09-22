import { DeleteItemCommand, GetItemCommand, PutItemCommand, UpdateItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { DynamoIdempotencyStore } from "./DynamoIdempotencyStore.js";

/** Enough of DynamoDB to exercise the conditional writes. */
function fakeDynamo() {
  const items = new Map<string, Record<string, { S?: string; N?: string }>>();
  const cond = (name: string) => Object.assign(new Error(name), { name });
  const client = {
    async send(cmd: PutItemCommand | GetItemCommand | UpdateItemCommand | DeleteItemCommand) {
      const now = Math.floor(Date.now() / 1000);
      if (cmd instanceof PutItemCommand) {
        const pk = cmd.input.Item!.pk.S!;
        const cur = items.get(pk);
        const ok = !cur || (cur.state.S === "inflight" && Number(cur.leaseUntil?.N) < now);
        if (!ok) throw cond("ConditionalCheckFailedException");
        items.set(pk, cmd.input.Item as Record<string, { S?: string; N?: string }>);
        return {};
      }
      if (cmd instanceof GetItemCommand) return { Item: items.get(cmd.input.Key!.pk.S!) };
      if (cmd instanceof UpdateItemCommand) {
        const pk = cmd.input.Key!.pk.S!;
        const cur = items.get(pk);
        if (!cur || cur.token.S !== cmd.input.ExpressionAttributeValues![":token"].S) throw cond("ConditionalCheckFailedException");
        items.set(pk, { ...cur, state: { S: "done" }, expires: cmd.input.ExpressionAttributeValues![":exp"] as { N: string } });
        return {};
      }
      if (cmd instanceof DeleteItemCommand) {
        const pk = cmd.input.Key!.pk.S!;
        const cur = items.get(pk);
        if (!cur || cur.token.S !== cmd.input.ExpressionAttributeValues![":token"].S || cur.state.S !== "inflight") throw cond("ConditionalCheckFailedException");
        items.delete(pk);
        return {};
      }
      throw new Error("unexpected command");
    },
  } as unknown as DynamoDBClient;
  return { client, items };
}

describe("DynamoIdempotencyStore", () => {
  it("claim → complete → done; a second claim reports done", async () => {
    const { client } = fakeDynamo();
    const store = new DynamoIdempotencyStore({ tableName: "t", client });
    expect(await store.claim("k", "t1", 1000)).toBe("claimed");
    await store.complete("k", "t1", 60);
    expect(await store.claim("k", "t2", 1000)).toBe("done");
  });

  it("a live lease is reported in_flight; an expired one is taken over; release frees it", async () => {
    const { client, items } = fakeDynamo();
    const store = new DynamoIdempotencyStore({ tableName: "t", client });
    expect(await store.claim("k", "t1", 60_000)).toBe("claimed");
    expect(await store.claim("k", "t2", 60_000)).toBe("in_flight");
    items.get("k")!.leaseUntil = { N: String(Math.floor(Date.now() / 1000) - 5) };
    expect(await store.claim("k", "t3", 60_000)).toBe("claimed");
    await store.release("k", "t1"); // wrong token: no-op
    expect(items.has("k")).toBe(true);
    await store.release("k", "t3");
    expect(items.has("k")).toBe(false);
  });

  it("a done marker past its logical expiry is treated as gone even if the row is still there", async () => {
    const { client, items } = fakeDynamo();
    const store = new DynamoIdempotencyStore({ tableName: "t", client });
    await store.claim("k", "t1", 1000);
    await store.complete("k", "t1", 60);
    items.get("k")!.expires = { N: String(Math.floor(Date.now() / 1000) - 1) };
    expect(await store.claim("k", "t2", 1000)).toBe("in_flight"); // conservative: not "done"
  });
});
