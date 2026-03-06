import { OnEvent } from "@tsed/event-emitter";

const LOG_PREFIX = "[event-broker]";

/**
 * Wrapper around @tsed/event-emitter's OnEvent.
 * Subscribes to events re-emitted from SQS and logs each listener invocation (event_id, listener name).
 */
export function OnSubscribe(eventName: string) {
  return function (target: object, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (payload: unknown, ...args: unknown[]) {
      const eventId =
        typeof payload === "object" && payload !== null && "eventId" in payload
          ? (payload as { eventId: string }).eventId
          : "unknown";
      console.info(`${LOG_PREFIX} Listener | event_id=${eventId} listener=${propertyKey}`);
      return originalMethod.apply(this, [payload, ...args]);
    };
    return OnEvent(eventName)(target, propertyKey, descriptor);
  };
}
