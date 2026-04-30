import type { DIConfiguration } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
export declare class SqsConsumer {
    private eventEmitter;
    private client;
    private readonly config;
    private readonly serviceName;
    private polling;
    private pollTimeoutId;
    private consecutivePollFailureLogged;
    constructor(eventEmitter: EventEmitterService, config: DIConfiguration);
    start(): void;
    stop(): void;
    private poll;
    private processMessage;
    private deleteMessage;
}
