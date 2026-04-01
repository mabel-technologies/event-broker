import type { EventBrokerConfig } from "../types/EventBrokerConfig";
/** @deprecated Config is read from Ts.ED Configuration via config.get("eventBroker"). */
export declare function setEventBrokerConfig(_config: EventBrokerConfig): void;
/** @deprecated Config is read from Ts.ED Configuration via config.get("eventBroker"). */
export declare function getEventBrokerConfig(): EventBrokerConfig | null;
