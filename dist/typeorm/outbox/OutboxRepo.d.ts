import type { DataSource, EntityManager } from "typeorm";
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
export declare function outboxRow(eventName: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>): EventOutboxEntity;
/** Run `work` and insert the outbox row in the same transaction. Returns the eventId that will be published. */
export declare function writeWithOutbox<T>(dataSource: DataSource, work: (em: EntityManager) => Promise<T>, event: {
    eventName: string;
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}): Promise<{
    result: T;
    eventId: string;
}>;
/** Portable (MySQL + Postgres) implementation: select candidates, lock by id, read back by token. */
export declare class TypeormOutboxRepo implements OutboxRepo {
    private readonly ds;
    constructor(ds: DataSource);
    private repo;
    claimBatch({ limit, lockToken, leaseMs, createdAfter }: ClaimBatchOptions): Promise<OutboxRow[]>;
    markPublished(id: string): Promise<void>;
    recordAttemptFailure(id: string, error: string, nextAttemptAt: Date): Promise<void>;
    markDead(id: string, error: string): Promise<void>;
    oldestPendingAgeMs(): Promise<number>;
    deadCount(): Promise<number>;
}
export declare const newLockToken: () => string;
