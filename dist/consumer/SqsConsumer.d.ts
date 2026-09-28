import type { DIConfiguration } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
export declare class SqsConsumer {
    private eventEmitter;
    private client;
    private readonly config;
    private readonly serviceName;
    private polling;
    private pollTimeoutId;
    private receiveBackoffMs;
    private readonly inFlight;
    constructor(eventEmitter: EventEmitterService, config: DIConfiguration);
    start(): Promise<void>;
    private assertQueueReachable;
    stop(): Promise<void>;
    private poll;
    private processMessage;
    /** No-DLQ-yet-safe rejection path for poison/unlistened messages: deletes unconditionally
     * unless ackOnSuccess is on, matching processMessage's success/failure gating below. */
    private rejectOrDelete;
    private handleHandlerFailure;
    /** Leaves the message undeleted with zero visibility so it's immediately eligible for
     * redelivery; once the queue has a RedrivePolicy, maxReceiveCount carries it to the DLQ with
     * its source intact. Sending it to a DLQ by hand instead would break native one-click redrive. */
    private rejectToDlq;
    private backoff;
    private deleteMessage;
}
