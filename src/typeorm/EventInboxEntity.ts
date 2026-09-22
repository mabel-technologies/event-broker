import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * Consumer inbox: one row per (service, eventId, handler). Works on MySQL and Postgres; the
 * matching migration is CreateEventInbox. Add this class to the service's entity list.
 */
@Entity("event_inbox")
export class EventInboxEntity {
  @PrimaryColumn({ name: "dedup_key", type: "varchar", length: 255 })
  dedupKey!: string;

  @Column({ type: "varchar", length: 16 })
  state!: "inflight" | "done";

  @Column({ type: "char", length: 36 })
  token!: string;

  @Column({ name: "lease_until", type: "timestamp", precision: 3 })
  leaseUntil!: Date;

  @Index("idx_event_inbox_expires")
  @Column({ name: "expires_at", type: "timestamp", precision: 3 })
  expiresAt!: Date;
}
