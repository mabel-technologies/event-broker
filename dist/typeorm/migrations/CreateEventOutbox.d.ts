import type { MigrationInterface, QueryRunner } from "typeorm";
/** Creates the producer outbox table on MySQL or Postgres. Re-export from the service's migrations directory. */
export declare class CreateEventOutbox1792000000001 implements MigrationInterface {
    name: string;
    up(q: QueryRunner): Promise<void>;
    down(q: QueryRunner): Promise<void>;
}
