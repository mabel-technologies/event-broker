import type { MigrationInterface, QueryRunner } from "typeorm";

/** Creates the producer outbox table on MySQL or Postgres. Re-export from the service's migrations directory. */
export class CreateEventOutbox1792000000001 implements MigrationInterface {
  name = "CreateEventOutbox1792000000001";

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === "postgres";
    const ts = pg ? "timestamptz(3)" : "timestamp(3)";
    const json = pg ? "jsonb" : "json";
    await q.query(
      `CREATE TABLE IF NOT EXISTS event_outbox (
        id char(36) NOT NULL PRIMARY KEY,
        event_id char(36) NOT NULL,
        event_name varchar(128) NOT NULL,
        payload ${json} NOT NULL,
        metadata ${json} NULL,
        status varchar(16) NOT NULL,
        attempt_count smallint NOT NULL DEFAULT 0,
        next_attempt_at ${ts} NOT NULL,
        locked_until ${ts} NULL,
        lock_token char(36) NULL,
        last_error text NULL,
        created_at ${ts} NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        published_at ${ts} NULL
      )`,
    );
    const indexes: Array<[string, string]> = [
      ["uq_event_outbox_event_id", "CREATE UNIQUE INDEX uq_event_outbox_event_id ON event_outbox (event_id)"],
      ["idx_event_outbox_pending", "CREATE INDEX idx_event_outbox_pending ON event_outbox (status, next_attempt_at)"],
    ];
    for (const [name, ddl] of indexes) {
      if (pg) {
        await q.query(ddl.replace("INDEX ", "INDEX IF NOT EXISTS "));
      } else {
        const existing = await q.query(`SHOW INDEX FROM event_outbox WHERE Key_name = '${name}'`);
        if (!Array.isArray(existing) || existing.length === 0) await q.query(ddl);
      }
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS event_outbox`);
  }
}
