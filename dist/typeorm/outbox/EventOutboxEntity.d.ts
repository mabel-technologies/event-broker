export type OutboxStatus = "PENDING" | "PUBLISHED" | "DEAD";
/**
 * Producer outbox: the event row is inserted in the same transaction as the business write and
 * published later by OutboxRelay. Payload always carries the eventId the relay will publish.
 */
export declare class EventOutboxEntity {
    id: string;
    eventId: string;
    eventName: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    status: OutboxStatus;
    attemptCount: number;
    nextAttemptAt: Date;
    lockedUntil: Date | null;
    lockToken: string | null;
    lastError: string | null;
    createdAt: Date;
    publishedAt: Date | null;
}
