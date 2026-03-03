import { EventBrokerConfig } from "../types/EventBrokerConfig";
export declare const EVENT_BROKER_CONFIG: unique symbol;
export interface SnsMessageBody {
    event_type: string;
    payload: unknown;
}
export declare class SnsPublisher {
    private config;
    private client;
    constructor(config: EventBrokerConfig);
    publish(eventType: string, payload: unknown): Promise<void>;
}
