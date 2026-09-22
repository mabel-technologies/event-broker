import type { DataSource } from "typeorm";
import type { ClaimResult, IdempotencyStore } from "../idempotency/IdempotencyStore.js";
import { EventInboxEntity } from "./EventInboxEntity.js";

const ABANDONED_ROW_TTL_MS = 86_400_000;

/** MySQL reports affectedRows; Postgres returns the RETURNING rows (empty when the insert was skipped). */
function insertedRows(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  const affected = (raw as { affectedRows?: number } | undefined)?.affectedRows;
  return typeof affected === "number" ? affected : 0;
}

/**
 * IdempotencyStore on the service's own SQL database (MySQL or Postgres via TypeORM).
 * Register it under IDEMPOTENCY_STORE and call load(dataSource) once the write datasource is up.
 * Handlers that write to the same database may additionally set state='done' inside their own
 * transaction (same-transaction marker); complete() is then a harmless repeat.
 */
export class SqlInboxIdempotencyStore implements IdempotencyStore {
  private ds: DataSource | null = null;

  constructor(dataSource?: DataSource) {
    if (dataSource) this.ds = dataSource;
  }

  load(dataSource: DataSource): void {
    this.ds = dataSource;
  }

  private repo() {
    if (!this.ds) throw new Error("[event-broker] SqlInboxIdempotencyStore: call load(dataSource) before use");
    return this.ds.getRepository(EventInboxEntity);
  }

  async claim(key: string, token: string, leaseMs: number): Promise<ClaimResult> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const repo = this.repo();
    // INSERT IGNORE / ON CONFLICT DO NOTHING: an existing row is the expected case on a redelivery and
    // must not surface as a query error in the service's logs. Anything else (DB down) propagates and
    // the decorator fails closed.
    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .into(EventInboxEntity)
      .values({ dedupKey: key, state: "inflight", token, leaseUntil, expiresAt: new Date(now.getTime() + ABANDONED_ROW_TTL_MS) })
      .orIgnore()
      .execute();
    if (insertedRows(inserted.raw) > 0) return "claimed";
    // Row exists: take over an expired in-flight lease atomically, else report what is there.
    const taken = await repo
      .createQueryBuilder()
      .update(EventInboxEntity)
      .set({ token, leaseUntil })
      .where("dedup_key = :key AND state = 'inflight' AND lease_until < :now", { key, now })
      .execute();
    if (taken.affected) return "claimed";
    const row = await repo.findOneBy({ dedupKey: key });
    return row?.state === "done" && row.expiresAt > now ? "done" : "in_flight";
  }

  async complete(key: string, token: string, retentionSeconds: number): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update(EventInboxEntity)
      .set({ state: "done", expiresAt: new Date(Date.now() + retentionSeconds * 1000) })
      .where("dedup_key = :key AND (token = :token OR state = 'done')", { key, token })
      .execute();
  }

  async release(key: string, token: string): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .delete()
      .from(EventInboxEntity)
      .where("dedup_key = :key AND token = :token AND state = 'inflight'", { key, token })
      .execute();
  }
}

/** Delete expired markers. Schedule it daily; SQL has no TTL. Returns the number of rows removed. */
export async function purgeExpiredInbox(dataSource: DataSource): Promise<number> {
  const result = await dataSource
    .getRepository(EventInboxEntity)
    .createQueryBuilder()
    .delete()
    .from(EventInboxEntity)
    .where("expires_at < :now", { now: new Date() })
    .execute();
  return result.affected ?? 0;
}
