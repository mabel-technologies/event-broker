var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Column, Entity, Index, PrimaryColumn } from "typeorm";
/**
 * Consumer inbox: one row per (service, eventId, handler). Works on MySQL and Postgres; the
 * matching migration is CreateEventInbox. Add this class to the service's entity list.
 */
let EventInboxEntity = class EventInboxEntity {
};
__decorate([
    PrimaryColumn({ name: "dedup_key", type: "varchar", length: 255 }),
    __metadata("design:type", String)
], EventInboxEntity.prototype, "dedupKey", void 0);
__decorate([
    Column({ type: "varchar", length: 16 }),
    __metadata("design:type", String)
], EventInboxEntity.prototype, "state", void 0);
__decorate([
    Column({ type: "char", length: 36 }),
    __metadata("design:type", String)
], EventInboxEntity.prototype, "token", void 0);
__decorate([
    Column({ name: "lease_until", type: "timestamp", precision: 3 }),
    __metadata("design:type", Date)
], EventInboxEntity.prototype, "leaseUntil", void 0);
__decorate([
    Index("idx_event_inbox_expires"),
    Column({ name: "expires_at", type: "timestamp", precision: 3 }),
    __metadata("design:type", Date)
], EventInboxEntity.prototype, "expiresAt", void 0);
EventInboxEntity = __decorate([
    Entity("event_inbox")
], EventInboxEntity);
export { EventInboxEntity };
