import { EventBrokerConfig } from "../types/EventBrokerConfig";
export declare const EVENT_BROKER_CONFIG: unique symbol;
export interface SnsMessageBody {
    event_type: string;
    event_id?: string;
    payload: unknown;
}
/** Payload shape passed to @OnSubscribe handlers: original payload with eventId injected. */
export interface BrokerPayloadWithEventId<T = unknown> {
    eventId: string;
    data?: T;
    [key: string]: unknown;
}
export declare class SnsPublisher {
    private config;
    private client;
    constructor(config: EventBrokerConfig);
    publish(eventType: string, payload: unknown): Promise<void>;
}
