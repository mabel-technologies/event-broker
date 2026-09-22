import type { Driver } from "neo4j-driver";
import type { ClaimResult, IdempotencyStore } from "../idempotency/IdempotencyStore.js";
/** Cypher shared with a repo that wants to claim inside its own graph transaction (auclair-be-networkgraph's GraphRepo). */
export declare const PROCESSED_EVENT_CLAIM_CYPHER = "\nMERGE (e:ProcessedEvent {id: $key})\nON CREATE SET e.state = 'PROCESSING', e.lockToken = $token, e.leaseUntil = $leaseUntil, e.expiresAt = $abandonedTtl, e.firstSeenAt = $now, e.lastSeenAt = $now\nON MATCH  SET e.lastSeenAt = $now\nWITH e\nFOREACH (_ IN CASE WHEN e.state = 'PROCESSING' AND e.leaseUntil < $now AND e.lockToken <> $token THEN [1] ELSE [] END |\n  SET e.lockToken = $token, e.leaseUntil = $leaseUntil)\nRETURN e.state AS state, e.lockToken AS lockToken, e.expiresAt AS expiresAt";
export declare const PROCESSED_EVENT_COMPLETE_CYPHER = "\nMATCH (e:ProcessedEvent {id: $key})\nWHERE e.lockToken = $token OR e.state = 'PROCESSED'\nSET e.state = 'PROCESSED', e.processedAt = $now, e.expiresAt = $expiresAt\nREMOVE e.lockToken, e.leaseUntil";
export declare const PROCESSED_EVENT_RELEASE_CYPHER = "\nMATCH (e:ProcessedEvent {id: $key, lockToken: $token})\nWHERE e.state = 'PROCESSING'\nDELETE e";
/** MERGE is only safe under concurrency with this constraint. Run at boot. */
export declare function ensureProcessedEventConstraint(driver: Driver, database?: string): Promise<void>;
/** Delete expired markers (Neo4j has no TTL). Schedule daily. */
export declare function purgeExpiredProcessedEvents(driver: Driver, database?: string): Promise<number>;
/**
 * IdempotencyStore on the same `ProcessedEvent` node auclair-be-networkgraph already uses.
 * A driver error propagates so the decorator fails closed.
 */
export declare class Neo4jInboxStore implements IdempotencyStore {
    private readonly driver;
    private readonly database?;
    constructor(driver: Driver, database?: string | undefined);
    claim(key: string, token: string, leaseMs: number): Promise<ClaimResult>;
    complete(key: string, token: string, retentionSeconds: number): Promise<void>;
    release(key: string, token: string): Promise<void>;
}
