import { type OutboxRepo } from "./OutboxRepo.js";
export interface OutboxRelayOptions {
    batch?: number;
    leaseMs?: number;
    maxAttempts?: number;
    /** First-run guard: ignore rows older than this (e.g. `new Date()` at deploy). Widen deliberately later. */
    createdAfter?: Date;
}
export interface OutboxRelayResult {
    claimed: number;
    published: number;
    failed: number;
    dead: number;
    oldestPendingAgeMs: number;
}
/**
 * Framework-free relay core. The service decides when to call runOnce() — a repeatable BullMQ
 * job, a cron, anything that runs on one replica at a time. An uncertain publish (published but
 * markPublished failed) is retried, and the consumer's idempotency absorbs the duplicate.
 */
export declare class OutboxRelay {
    private readonly repo;
    private readonly publish;
    private readonly opts;
    constructor(repo: OutboxRepo, publish: (eventName: string, payload: {
        eventId: string;
    } & Record<string, unknown>) => Promise<void>, opts?: OutboxRelayOptions);
    runOnce(): Promise<OutboxRelayResult>;
}
