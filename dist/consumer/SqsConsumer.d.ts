import { Message } from "@aws-sdk/client-sqs";
import type { DIConfiguration } from "@tsed/di";
/** The subset of @tsed/event-emitter (eventemitter2) the consumer relies on. */
export interface EmitterLike {
    emitAsync(event: string, payload: unknown): Promise<unknown>;
    listenerCount?(event: string): number;
}
export type ConsumeOutcome = "acked" | "retry" | "poisoned" | "no_listener" | "malformed";
export declare class SqsConsumer {
    private eventEmitter;
    private client;
    private readonly config;
    private readonly serviceName;
    private readonly ackOnSuccess;
    private readonly visibilitySeconds;
    private polling;
    private pollTimeoutId;
    private receiveBackoffMs;
    private abort;
    private readonly inFlight;
    private currentPoll;
    private listenerCountWarned;
    constructor(eventEmitter: EmitterLike, config: DIConfiguration);
    /**
     * Called by the module before start(). Throws so a service that cannot reach its queue fails
     * boot instead of polling nothing forever. Also refuses ackOnSuccess on a queue without a
     * dead-letter queue: a poison message would otherwise cycle until retention expires.
     */
    assertReady(): Promise<void>;
    start(): void;
    private schedule;
    /** Stop polling, wait for in-flight handlers (capped), then hand back anything unfinished immediately. */
    stop(): Promise<void>;
    private poll;
    /** Exposed for tests. Processes one message exactly as the poll loop would. */
    handleMessage(message: Message): Promise<void>;
    private hasNoListener;
    /** Extend the lease at half the visibility timeout while the handler runs; warn, don't cancel, when it is slow. */
    private runWithLease;
    /**
     * Never SendMessage to the DLQ: leave the message and let maxReceiveCount move it, so
     * console redrive keeps working. With ackOnSuccess off the message is still deleted, but the
     * outcome is counted so the would-be dead-letter rate is visible before the flip.
     */
    private reject;
    private backoff;
    private parse;
    private logHandlerFailed;
    /** One structured line per outcome; Loki counts these. */
    private count;
    private setVisibility;
    private deleteMessage;
}
