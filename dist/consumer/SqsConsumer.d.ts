import { EventEmitterService } from "@tsed/event-emitter";
import { EventBrokerConfig } from "../types/EventBrokerConfig";
export declare class SqsConsumer {
    private config;
    private eventEmitter;
    private client;
    private polling;
    private pollTimeoutId;
    constructor(config: EventBrokerConfig, eventEmitter: EventEmitterService);
    start(): void;
    stop(): void;
    private poll;
    private processMessage;
    private deleteMessage;
}
