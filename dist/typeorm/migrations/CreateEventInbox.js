/**
 * Creates the consumer inbox table on MySQL or Postgres. Re-export this class from the
 * service's own migrations directory so TypeORM picks it up:
 *   export { CreateEventInbox1792000000000 } from "@mabel-technologies/event-broker/typeorm";
 */
export class CreateEventInbox1792000000000 {
    constructor() {
        this.name = "CreateEventInbox1792000000000";
    }
    async up(q) {
        const pg = q.connection.options.type === "postgres";
        const ts = pg ? "timestamptz(3)" : "timestamp(3)";
        await q.query(`CREATE TABLE IF NOT EXISTS event_inbox (
        dedup_key varchar(255) NOT NULL PRIMARY KEY,
        state varchar(16) NOT NULL,
        token char(36) NOT NULL,
        lease_until ${ts} NOT NULL,
        expires_at ${ts} NOT NULL
      )`);
        if (pg) {
            await q.query(`CREATE INDEX IF NOT EXISTS idx_event_inbox_expires ON event_inbox (expires_at)`);
        }
        else {
            const existing = await q.query(`SHOW INDEX FROM event_inbox WHERE Key_name = 'idx_event_inbox_expires'`);
            if (!Array.isArray(existing) || existing.length === 0) {
                await q.query(`CREATE INDEX idx_event_inbox_expires ON event_inbox (expires_at)`);
            }
        }
    }
    async down(q) {
        await q.query(`DROP TABLE IF EXISTS event_inbox`);
    }
}
