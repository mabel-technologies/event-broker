import type { MigrationInterface, QueryRunner } from "typeorm";
/**
 * Creates the consumer inbox table on MySQL or Postgres. Re-export this class from the
 * service's own migrations directory so TypeORM picks it up:
 *   export { CreateEventInbox1792000000000 } from "@mabel-technologies/event-broker/typeorm";
 */
export declare class CreateEventInbox1792000000000 implements MigrationInterface {
    name: string;
    up(q: QueryRunner): Promise<void>;
    down(q: QueryRunner): Promise<void>;
}
