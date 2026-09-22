import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
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
export declare class DynamoIdempotencyStore implements IdempotencyStore {
    private readonly ddb;
    private readonly table;
    private readonly abandonedTtl;
    constructor(options: DynamoIdempotencyStoreOptions);
    claim(key: string, token: string, leaseMs: number): Promise<ClaimResult>;
    complete(key: string, token: string, retentionSeconds: number): Promise<void>;
    release(key: string, token: string): Promise<void>;
}
