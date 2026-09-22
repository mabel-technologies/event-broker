import { $log } from "@tsed/logger";
import { newLockToken } from "./OutboxRepo.js";
/**
 * Framework-free relay core. The service decides when to call runOnce() — a repeatable BullMQ
 * job, a cron, anything that runs on one replica at a time. An uncertain publish (published but
 * markPublished failed) is retried, and the consumer's idempotency absorbs the duplicate.
 */
export class OutboxRelay {
    constructor(repo, publish, opts = {}) {
        this.repo = repo;
        this.publish = publish;
        this.opts = opts;
    }
    async runOnce() {
        const lockToken = newLockToken();
        const rows = await this.repo.claimBatch({
            limit: this.opts.batch ?? 100,
            lockToken,
            leaseMs: this.opts.leaseMs ?? 30000,
            createdAfter: this.opts.createdAfter,
        });
        let published = 0;
        let failed = 0;
        let dead = 0;
        const maxAttempts = this.opts.maxAttempts ?? 10;
        for (const row of rows) {
            try {
                await this.publish(row.eventName, row.payload);
                await this.repo.markPublished(row.id);
                published++;
            }
            catch (err) {
                const attempts = row.attemptCount + 1;
                const message = err?.message ?? String(err);
                if (attempts >= maxAttempts) {
                    await this.repo.markDead(row.id, message);
                    dead++;
                    $log.error(`[event-broker] outbox.dead | eventName=${row.eventName} eventId=${row.eventId} attempts=${attempts} error=${message}`);
                }
                else {
                    const delaySec = Math.min(2 ** attempts, 900);
                    await this.repo.recordAttemptFailure(row.id, message, new Date(Date.now() + delaySec * 1000));
                    failed++;
                    $log.warn(`[event-broker] outbox.retry | eventName=${row.eventName} eventId=${row.eventId} attempts=${attempts} nextInSec=${delaySec}`);
                }
            }
        }
        const oldestPendingAgeMs = await this.repo.oldestPendingAgeMs();
        const result = { claimed: rows.length, published, failed, dead, oldestPendingAgeMs };
        $log.info({ metric: "outbox_relay", ...result });
        return result;
    }
}
