// const GLOBAL_KEY = "__EVENT_BROKER_CONFIG__";
// export function setEventBrokerConfig(config: EventBrokerConfig): void {
//   (globalThis as unknown as Record<string, EventBrokerConfig | null>)[GLOBAL_KEY] = config;
// }
// export function getEventBrokerConfig(): EventBrokerConfig | null {
//   return (globalThis as unknown as Record<string, EventBrokerConfig | null>)[GLOBAL_KEY] ?? null;
// }
/** @deprecated Config is read from Ts.ED Configuration via config.get("eventBroker"). */
export function setEventBrokerConfig(_config) { }
/** @deprecated Config is read from Ts.ED Configuration via config.get("eventBroker"). */
export function getEventBrokerConfig() {
    return null;
}
