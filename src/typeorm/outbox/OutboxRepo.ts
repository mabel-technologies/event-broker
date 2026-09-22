import { randomUUID } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { v7 as uuid7 } from "uuid";
import { EventOutboxEntity } from "./EventOutboxEntity.js";

export interface OutboxRow {
  id: string;
  eventId: string;
  eventName: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

export interface ClaimBatchOptions {
  limit: number;
  lockToken: string;
  leaseMs: number;
  /** Only rows created after this instant (first-run guard). */
  createdAfter?: Date;
}

export interface OutboxRepo {
  claimBatch(opts: ClaimBatchOptions): Promise<OutboxRow[]>;
  markPublished(id: string): Promise<void>;
  recordAttemptFailure(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  /** Age in ms of the oldest PENDING row, or 0. For the relay-age alarm. */
  oldestPendingAgeMs(): Promise<number>;
  deadCount(): Promise<number>;
}

/** Build a PENDING outbox row. Use inside the business transaction: `em.insert(EventOutboxEntity, outboxRow(...))`. */
export function outboxRow(eventName: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>): EventOutboxEntity {
  const eventId = uuid7();
  const row = new EventOutboxEntity();
  row.id = uuid7();
  row.eventId = eventId;
  row.eventName = eventName;
  row.payload = { ...payload, eventId };
  row.metadata = metadata ?? null;
  row.status = "PENDING";
  row.attemptCount = 0;
  row.nextAttemptAt = new Date();
  row.lockedUntil = null;
  row.lockToken = null;
  row.lastError = null;
  row.publishedAt = null;
  return row;
}

/** Run `work` and insert the outbox row in the same transaction. Returns the eventId that will be published. */
export async function writeWithOutbox<T>(
  dataSource: DataSource,
  work: (em: EntityManager) => Promise<T>,
  event: { eventName: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> },
): Promise<{ result: T; eventId: string }> {
  const row = outboxRow(event.eventName, event.payload, event.metadata);
  const result = await dataSource.transaction(async (em) => {
    const r = await work(em);
    await em.save(EventOutboxEntity, row);
    return r;
  });
  return { result, eventId: row.eventId };
}

/** Portable (MySQL + Postgres) implementation: select candidates, lock by id, read back by token. */
export class TypeormOutboxRepo implements OutboxRepo {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(EventOutboxEntity);
  }

  async claimBatch({ limit, lockToken, leaseMs, createdAfter }: ClaimBatchOptions): Promise<OutboxRow[]> {
    const now = new Date();
    const qb = this.repo()
      .createQueryBuilder("o")
      .select("o.id", "id")
      .where("o.status = 'PENDING' AND o.next_attempt_at <= :now AND (o.locked_until IS NULL OR o.locked_until < :now)", { now })
      .orderBy("o.next_attempt_at", "ASC")
      .limit(limit);
    if (createdAfter) qb.andWhere("o.created_at > :createdAfter", { createdAfter });
    const candidates = (await qb.getRawMany<{ id: string }>()).map((r) => r.id);
    if (candidates.length === 0) return [];

    await this.repo()
      .createQueryBuilder()
      .update(EventOutboxEntity)
      .set({ lockToken, lockedUntil: new Date(now.getTime() + leaseMs) })
      .where("id IN (:...ids) AND status = 'PENDING' AND (locked_until IS NULL OR locked_until < :now)", { ids: candidates, now })
      .execute();

    const rows = await this.repo().find({ where: { lockToken }, order: { nextAttemptAt: "ASC" } });
    return rows.map((r) => ({ id: r.id, eventId: r.eventId, eventName: r.eventName, payload: r.payload, attemptCount: r.attemptCount }));
  }

  async markPublished(id: string): Promise<void> {
    await this.repo().update({ id }, { status: "PUBLISHED", publishedAt: new Date(), lockToken: null, lockedUntil: null });
  }

  async recordAttemptFailure(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update(EventOutboxEntity)
      .set({ attemptCount: () => "attempt_count + 1", lastError: error.slice(0, 4000), nextAttemptAt, lockToken: null, lockedUntil: null })
      .where("id = :id", { id })
      .execute();
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.repo()
      .createQueryBuilder()
      .update(EventOutboxEntity)
      .set({ status: "DEAD", attemptCount: () => "attempt_count + 1", lastError: error.slice(0, 4000), lockToken: null, lockedUntil: null })
      .where("id = :id", { id })
      .execute();
  }

  async oldestPendingAgeMs(): Promise<number> {
    const row = await this.repo().findOne({ where: { status: "PENDING" }, order: { createdAt: "ASC" } });
    return row ? Date.now() - row.createdAt.getTime() : 0;
  }

  async deadCount(): Promise<number> {
    return this.repo().count({ where: { status: "DEAD" } });
  }
}

export const newLockToken = (): string => randomUUID();
