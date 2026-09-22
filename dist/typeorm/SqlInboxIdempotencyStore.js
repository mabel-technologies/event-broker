import { EventInboxEntity } from "./EventInboxEntity.js";
const ABANDONED_ROW_TTL_MS = 86400000;
function isUniqueViolation(err) {
    const e = err;
    const code = e?.code ?? e?.driverError?.code;
    const errno = e?.errno ?? e?.driverError?.errno;
    return code === "ER_DUP_ENTRY" || errno === 1062 || code === "23505" || code === "SQLITE_CONSTRAINT";
}
/**
 * IdempotencyStore on the service's own SQL database (MySQL or Postgres via TypeORM).
 * Register it under IDEMPOTENCY_STORE and call load(dataSource) once the write datasource is up.
 * Handlers that write to the same database may additionally set state='done' inside their own
 * transaction (same-transaction marker); complete() is then a harmless repeat.
 */
export class SqlInboxIdempotencyStore {
    constructor(dataSource) {
        this.ds = null;
        if (dataSource)
            this.ds = dataSource;
    }
    load(dataSource) {
        this.ds = dataSource;
    }
    repo() {
        if (!this.ds)
            throw new Error("[event-broker] SqlInboxIdempotencyStore: call load(dataSource) before use");
        return this.ds.getRepository(EventInboxEntity);
    }
    async claim(key, token, leaseMs) {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + leaseMs);
        const repo = this.repo();
        try {
            await repo.insert({ dedupKey: key, state: "inflight", token, leaseUntil, expiresAt: new Date(now.getTime() + ABANDONED_ROW_TTL_MS) });
            return "claimed";
        }
        catch (err) {
            if (!isUniqueViolation(err))
                throw err; // DB down → propagate → decorator fails closed
        }
        // Row exists: take over an expired in-flight lease atomically, else report what is there.
        const taken = await repo
            .createQueryBuilder()
            .update(EventInboxEntity)
            .set({ token, leaseUntil })
            .where("dedup_key = :key AND state = 'inflight' AND lease_until < :now", { key, now })
            .execute();
        if (taken.affected)
            return "claimed";
        const row = await repo.findOneBy({ dedupKey: key });
        return row?.state === "done" && row.expiresAt > now ? "done" : "in_flight";
    }
    async complete(key, token, retentionSeconds) {
        await this.repo()
            .createQueryBuilder()
            .update(EventInboxEntity)
            .set({ state: "done", expiresAt: new Date(Date.now() + retentionSeconds * 1000) })
            .where("dedup_key = :key AND (token = :token OR state = 'done')", { key, token })
            .execute();
    }
    async release(key, token) {
        await this.repo()
            .createQueryBuilder()
            .delete()
            .from(EventInboxEntity)
            .where("dedup_key = :key AND token = :token AND state = 'inflight'", { key, token })
            .execute();
    }
}
/** Delete expired markers. Schedule it daily; SQL has no TTL. Returns the number of rows removed. */
export async function purgeExpiredInbox(dataSource) {
    const result = await dataSource
        .getRepository(EventInboxEntity)
        .createQueryBuilder()
        .delete()
        .from(EventInboxEntity)
        .where("expires_at < :now", { now: new Date() })
        .execute();
    return result.affected ?? 0;
}
