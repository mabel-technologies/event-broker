import type { DIConfiguration } from "@tsed/di";
export declare const EVENT_BROKER_CONFIG: unique symbol;
/** @deprecated Use EventBrokerModule.forRoot(config) instead. */
export declare const EVENT_BROKER_CONFIG_OPTIONS: unique symbol;
export interface SnsMessageBody {
    eventType: string;
    /** @deprecated Use eventType. Accepted for backward compatibility with old messages. */
    event_type?: string;
    event_id?: string;
    payload: unknown;
}
/** Payload passed to @OnSubscribe handlers: original payload with eventId injected. */
export interface BrokerPayloadWithEventId<T = unknown> {
    eventId: string;
    data?: T;
    [key: string]: unknown;
}
export declare class SnsPublisher {
    private client;
    private readonly config;
    constructor(config: DIConfiguration);
    publish(eventType: string, payload: unknown): Promise<void>;
}
