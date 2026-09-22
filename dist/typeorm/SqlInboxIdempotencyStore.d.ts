import type { DataSource } from "typeorm";
import type { ClaimResult, IdempotencyStore } from "../idempotency/IdempotencyStore.js";
/**
 * IdempotencyStore on the service's own SQL database (MySQL or Postgres via TypeORM).
 * Register it under IDEMPOTENCY_STORE and call load(dataSource) once the write datasource is up.
 * Handlers that write to the same database may additionally set state='done' inside their own
 * transaction (same-transaction marker); complete() is then a harmless repeat.
 */
export declare class SqlInboxIdempotencyStore implements IdempotencyStore {
    private ds;
    constructor(dataSource?: DataSource);
    load(dataSource: DataSource): void;
    private repo;
    claim(key: string, token: string, leaseMs: number): Promise<ClaimResult>;
    complete(key: string, token: string, retentionSeconds: number): Promise<void>;
    release(key: string, token: string): Promise<void>;
}
/** Delete expired markers. Schedule it daily; SQL has no TTL. Returns the number of rows removed. */
export declare function purgeExpiredInbox(dataSource: DataSource): Promise<number>;
