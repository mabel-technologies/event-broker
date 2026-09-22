import { randomUUID } from "node:crypto";
import { v7 as uuid7 } from "uuid";
import { EventOutboxEntity } from "./EventOutboxEntity.js";
/** Build a PENDING outbox row. Use inside the business transaction: `em.insert(EventOutboxEntity, outboxRow(...))`. */
export function outboxRow(eventName, payload, metadata) {
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
export async function writeWithOutbox(dataSource, work, event) {
    const row = outboxRow(event.eventName, event.payload, event.metadata);
    const result = await dataSource.transaction(async (em) => {
        const r = await work(em);
        await em.save(EventOutboxEntity, row);
        return r;
    });
    return { result, eventId: row.eventId };
}
/** Portable (MySQL + Postgres) implementation: select candidates, lock by id, read back by token. */
export class TypeormOutboxRepo {
    constructor(ds) {
        this.ds = ds;
    }
    repo() {
        return this.ds.getRepository(EventOutboxEntity);
    }
    async claimBatch({ limit, lockToken, leaseMs, createdAfter }) {
        const now = new Date();
        const qb = this.repo()
            .createQueryBuilder("o")
            .select("o.id", "id")
            .where("o.status = 'PENDING' AND o.next_attempt_at <= :now AND (o.locked_until IS NULL OR o.locked_until < :now)", { now })
            .orderBy("o.next_attempt_at", "ASC")
            .limit(limit);
        if (createdAfter)
            qb.andWhere("o.created_at > :createdAfter", { createdAfter });
        const candidates = (await qb.getRawMany()).map((r) => r.id);
        if (candidates.length === 0)
            return [];
        await this.repo()
            .createQueryBuilder()
            .update(EventOutboxEntity)
            .set({ lockToken, lockedUntil: new Date(now.getTime() + leaseMs) })
            .where("id IN (:...ids) AND status = 'PENDING' AND (locked_until IS NULL OR locked_until < :now)", { ids: candidates, now })
            .execute();
        const rows = await this.repo().find({ where: { lockToken }, order: { nextAttemptAt: "ASC" } });
        return rows.map((r) => ({ id: r.id, eventId: r.eventId, eventName: r.eventName, payload: r.payload, attemptCount: r.attemptCount }));
    }
    async markPublished(id) {
        await this.repo().update({ id }, { status: "PUBLISHED", publishedAt: new Date(), lockToken: null, lockedUntil: null });
    }
    async recordAttemptFailure(id, error, nextAttemptAt) {
        await this.repo()
            .createQueryBuilder()
            .update(EventOutboxEntity)
            .set({ attemptCount: () => "attempt_count + 1", lastError: error.slice(0, 4000), nextAttemptAt, lockToken: null, lockedUntil: null })
            .where("id = :id", { id })
            .execute();
    }
    async markDead(id, error) {
        await this.repo()
            .createQueryBuilder()
            .update(EventOutboxEntity)
            .set({ status: "DEAD", attemptCount: () => "attempt_count + 1", lastError: error.slice(0, 4000), lockToken: null, lockedUntil: null })
            .where("id = :id", { id })
            .execute();
    }
    async oldestPendingAgeMs() {
        const row = await this.repo().findOne({ where: { status: "PENDING" }, order: { createdAt: "ASC" } });
        return row ? Date.now() - row.createdAt.getTime() : 0;
    }
    async deadCount() {
        return this.repo().count({ where: { status: "DEAD" } });
    }
}
export const newLockToken = () => randomUUID();
