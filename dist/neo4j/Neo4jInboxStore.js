const ABANDONED_ROW_TTL_MS = 86400000;
/** Cypher shared with a repo that wants to claim inside its own graph transaction (auclair-be-networkgraph's GraphRepo). */
export const PROCESSED_EVENT_CLAIM_CYPHER = `
MERGE (e:ProcessedEvent {id: $key})
ON CREATE SET e.state = 'PROCESSING', e.lockToken = $token, e.leaseUntil = $leaseUntil, e.expiresAt = $abandonedTtl, e.firstSeenAt = $now, e.lastSeenAt = $now
ON MATCH  SET e.lastSeenAt = $now
WITH e
FOREACH (_ IN CASE WHEN e.state = 'PROCESSING' AND e.leaseUntil < $now AND e.lockToken <> $token THEN [1] ELSE [] END |
  SET e.lockToken = $token, e.leaseUntil = $leaseUntil)
RETURN e.state AS state, e.lockToken AS lockToken, e.expiresAt AS expiresAt`;
export const PROCESSED_EVENT_COMPLETE_CYPHER = `
MATCH (e:ProcessedEvent {id: $key})
WHERE e.lockToken = $token OR e.state = 'PROCESSED'
SET e.state = 'PROCESSED', e.processedAt = $now, e.expiresAt = $expiresAt
REMOVE e.lockToken, e.leaseUntil`;
export const PROCESSED_EVENT_RELEASE_CYPHER = `
MATCH (e:ProcessedEvent {id: $key, lockToken: $token})
WHERE e.state = 'PROCESSING'
DELETE e`;
/** MERGE is only safe under concurrency with this constraint. Run at boot. */
export async function ensureProcessedEventConstraint(driver, database) {
    const session = driver.session({ database });
    try {
        await session.run("CREATE CONSTRAINT processed_event_id IF NOT EXISTS FOR (e:ProcessedEvent) REQUIRE e.id IS UNIQUE");
    }
    finally {
        await session.close();
    }
}
/** Delete expired markers (Neo4j has no TTL). Schedule daily. */
export async function purgeExpiredProcessedEvents(driver, database) {
    const session = driver.session({ database });
    try {
        const r = await session.run("MATCH (e:ProcessedEvent) WHERE e.expiresAt < $now WITH e LIMIT 10000 DETACH DELETE e RETURN count(*) AS n", {
            now: Date.now(),
        });
        return Number(r.records[0]?.get("n") ?? 0);
    }
    finally {
        await session.close();
    }
}
/**
 * IdempotencyStore on the same `ProcessedEvent` node auclair-be-networkgraph already uses.
 * A driver error propagates so the decorator fails closed.
 */
export class Neo4jInboxStore {
    constructor(driver, database) {
        this.driver = driver;
        this.database = database;
    }
    async claim(key, token, leaseMs) {
        const now = Date.now();
        const session = this.driver.session({ database: this.database });
        try {
            const r = await session.executeWrite((tx) => tx.run(PROCESSED_EVENT_CLAIM_CYPHER, { key, token, now, leaseUntil: now + leaseMs, abandonedTtl: now + ABANDONED_ROW_TTL_MS }));
            const rec = r.records[0];
            const state = rec?.get("state");
            const lockToken = rec?.get("lockToken");
            const expiresAt = Number(rec?.get("expiresAt") ?? 0);
            if (state === "PROCESSING" && lockToken === token)
                return "claimed";
            if (state === "PROCESSED" && expiresAt > now)
                return "done";
            return "in_flight";
        }
        finally {
            await session.close();
        }
    }
    async complete(key, token, retentionSeconds) {
        const session = this.driver.session({ database: this.database });
        try {
            await session.executeWrite((tx) => tx.run(PROCESSED_EVENT_COMPLETE_CYPHER, { key, token, now: Date.now(), expiresAt: Date.now() + retentionSeconds * 1000 }));
        }
        finally {
            await session.close();
        }
    }
    async release(key, token) {
        const session = this.driver.session({ database: this.database });
        try {
            await session.executeWrite((tx) => tx.run(PROCESSED_EVENT_RELEASE_CYPHER, { key, token }));
        }
        finally {
            await session.close();
        }
    }
}
