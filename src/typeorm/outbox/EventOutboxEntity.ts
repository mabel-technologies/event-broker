import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

export type OutboxStatus = "PENDING" | "PUBLISHED" | "DEAD";

/**
 * Producer outbox: the event row is inserted in the same transaction as the business write and
 * published later by OutboxRelay. Payload always carries the eventId the relay will publish.
 */
@Entity("event_outbox")
@Index("idx_event_outbox_pending", ["status", "nextAttemptAt"])
export class EventOutboxEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Index("uq_event_outbox_event_id", { unique: true })
  @Column({ name: "event_id", type: "char", length: 36 })
  eventId!: string;

  @Column({ name: "event_name", type: "varchar", length: 128 })
  eventName!: string;

  @Column({ type: "simple-json" })
  payload!: Record<string, unknown>;

  @Column({ type: "simple-json", nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: "varchar", length: 16 })
  status!: OutboxStatus;

  @Column({ name: "attempt_count", type: "smallint", default: 0 })
  attemptCount!: number;

  @Column({ name: "next_attempt_at", type: "timestamp", precision: 3 })
  nextAttemptAt!: Date;

  @Column({ name: "locked_until", type: "timestamp", precision: 3, nullable: true })
  lockedUntil!: Date | null;

  @Column({ name: "lock_token", type: "char", length: 36, nullable: true })
  lockToken!: string | null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 })
  createdAt!: Date;

  @Column({ name: "published_at", type: "timestamp", precision: 3, nullable: true })
  publishedAt!: Date | null;
}
