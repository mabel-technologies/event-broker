import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import type { ClaimResult, IdempotencyStore } from "../idempotency/IdempotencyStore.js";

export interface DynamoIdempotencyStoreOptions {
  tableName: string;
  /** Provide a configured client (endpoint, region). Default: new DynamoDBClient({ region }). */
  client?: DynamoDBClient;
  region?: string;
  /** TTL for a row somebody claimed and never completed. Default 1 day. */
  abandonedRowTtlSeconds?: number;
}

/**
 * Table: `pk` (S) hash key, TTL attribute `expires`. For handlers whose side effect is external
 * (push, chat, third-party call), where the service's own database cannot hold the marker in the
 * same transaction. TTL deletion is asynchronous, so logical expiry is checked, not row presence.
 */
export class DynamoIdempotencyStore implements IdempotencyStore {
  private readonly ddb: DynamoDBClient;
  private readonly table: string;
  private readonly abandonedTtl: number;

  constructor(options: DynamoIdempotencyStoreOptions) {
    this.ddb = options.client ?? new DynamoDBClient({ region: options.region ?? "us-east-2" });
    this.table = options.tableName;
    this.abandonedTtl = options.abandonedRowTtlSeconds ?? 86_400;
  }

  async claim(key: string, token: string, leaseMs: number): Promise<ClaimResult> {
    const now = Math.floor(Date.now() / 1000);
    const leaseUntil = now + Math.ceil(leaseMs / 1000);
    try {
      await this.ddb.send(
        new PutItemCommand({
          TableName: this.table,
          Item: {
            pk: { S: key },
            state: { S: "inflight" },
            token: { S: token },
            leaseUntil: { N: String(leaseUntil) },
            expires: { N: String(leaseUntil + this.abandonedTtl) },
          },
          ConditionExpression: "attribute_not_exists(pk) OR (#s = :inflight AND leaseUntil < :now)",
          ExpressionAttributeNames: { "#s": "state" },
          ExpressionAttributeValues: { ":inflight": { S: "inflight" }, ":now": { N: String(now) } },
        }),
      );
      return "claimed";
    } catch (err) {
      if ((err as Error)?.name !== "ConditionalCheckFailedException") throw err;
      const cur = await this.ddb.send(new GetItemCommand({ TableName: this.table, Key: { pk: { S: key } }, ConsistentRead: true }));
      const state = cur.Item?.state?.S;
      const expires = Number(cur.Item?.expires?.N ?? 0);
      return state === "done" && expires > now ? "done" : "in_flight";
    }
  }

  async complete(key: string, token: string, retentionSeconds: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.ddb.send(
      new UpdateItemCommand({
        TableName: this.table,
        Key: { pk: { S: key } },
        UpdateExpression: "SET #s = :done, expires = :exp REMOVE leaseUntil",
        ConditionExpression: "#t = :token",
        ExpressionAttributeNames: { "#s": "state", "#t": "token" },
        ExpressionAttributeValues: {
          ":done": { S: "done" },
          ":exp": { N: String(now + retentionSeconds) },
          ":token": { S: token },
        },
      }),
    );
  }

  async release(key: string, token: string): Promise<void> {
    try {
      await this.ddb.send(
        new DeleteItemCommand({
          TableName: this.table,
          Key: { pk: { S: key } },
          ConditionExpression: "#t = :token AND #s = :inflight",
          ExpressionAttributeNames: { "#t": "token", "#s": "state" },
          ExpressionAttributeValues: { ":token": { S: token }, ":inflight": { S: "inflight" } },
        }),
      );
    } catch (err) {
      if ((err as Error)?.name !== "ConditionalCheckFailedException") throw err;
    }
  }
}
