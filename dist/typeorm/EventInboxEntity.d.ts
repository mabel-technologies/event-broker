/**
 * Consumer inbox: one row per (service, eventId, handler). Works on MySQL and Postgres; the
 * matching migration is CreateEventInbox. Add this class to the service's entity list.
 */
export declare class EventInboxEntity {
    dedupKey: string;
    state: "inflight" | "done";
    token: string;
    leaseUntil: Date;
    expiresAt: Date;
}
