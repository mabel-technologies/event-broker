import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";
/** @deprecated Config is read from Ts.ED Configuration via config.get("eventBroker"). */
export declare function setEventBrokerConfig(_config: EventBrokerConfig): void;
/** @deprecated Config is read from Ts.ED Configuration via config.get("eventBroker"). */
export declare function getEventBrokerConfig(): EventBrokerConfig | null;
