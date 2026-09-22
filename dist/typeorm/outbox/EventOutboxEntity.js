var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";
/**
 * Producer outbox: the event row is inserted in the same transaction as the business write and
 * published later by OutboxRelay. Payload always carries the eventId the relay will publish.
 */
let EventOutboxEntity = class EventOutboxEntity {
};
__decorate([
    PrimaryColumn({ type: "char", length: 36 }),
    __metadata("design:type", String)
], EventOutboxEntity.prototype, "id", void 0);
__decorate([
    Index("uq_event_outbox_event_id", { unique: true }),
    Column({ name: "event_id", type: "char", length: 36 }),
    __metadata("design:type", String)
], EventOutboxEntity.prototype, "eventId", void 0);
__decorate([
    Column({ name: "event_name", type: "varchar", length: 128 }),
    __metadata("design:type", String)
], EventOutboxEntity.prototype, "eventName", void 0);
__decorate([
    Column({ type: "simple-json" }),
    __metadata("design:type", Object)
], EventOutboxEntity.prototype, "payload", void 0);
__decorate([
    Column({ type: "simple-json", nullable: true }),
    __metadata("design:type", Object)
], EventOutboxEntity.prototype, "metadata", void 0);
__decorate([
    Column({ type: "varchar", length: 16 }),
    __metadata("design:type", String)
], EventOutboxEntity.prototype, "status", void 0);
__decorate([
    Column({ name: "attempt_count", type: "smallint", default: 0 }),
    __metadata("design:type", Number)
], EventOutboxEntity.prototype, "attemptCount", void 0);
__decorate([
    Column({ name: "next_attempt_at", type: "timestamp", precision: 3 }),
    __metadata("design:type", Date)
], EventOutboxEntity.prototype, "nextAttemptAt", void 0);
__decorate([
    Column({ name: "locked_until", type: "timestamp", precision: 3, nullable: true }),
    __metadata("design:type", Object)
], EventOutboxEntity.prototype, "lockedUntil", void 0);
__decorate([
    Column({ name: "lock_token", type: "char", length: 36, nullable: true }),
    __metadata("design:type", Object)
], EventOutboxEntity.prototype, "lockToken", void 0);
__decorate([
    Column({ name: "last_error", type: "text", nullable: true }),
    __metadata("design:type", Object)
], EventOutboxEntity.prototype, "lastError", void 0);
__decorate([
    CreateDateColumn({ name: "created_at", type: "timestamp", precision: 3 }),
    __metadata("design:type", Date)
], EventOutboxEntity.prototype, "createdAt", void 0);
__decorate([
    Column({ name: "published_at", type: "timestamp", precision: 3, nullable: true }),
    __metadata("design:type", Object)
], EventOutboxEntity.prototype, "publishedAt", void 0);
EventOutboxEntity = __decorate([
    Entity("event_outbox"),
    Index("idx_event_outbox_pending", ["status", "nextAttemptAt"])
], EventOutboxEntity);
export { EventOutboxEntity };
