import { OnEvent } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
const LOG_PREFIX = "[event-broker]";
/** Subscribes to events from SQS and logs each listener invocation. */
export function OnSubscribe(eventName) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (payload, ...args) {
            const eventId = typeof payload === "object" && payload !== null && "eventId" in payload
                ? payload.eventId
                : "unknown";
            $log.info(`${LOG_PREFIX} Listener | eventName=${eventName} eventId=${eventId} listener=${propertyKey}`);
            return originalMethod.apply(this, [payload, ...args]);
        };
        return OnEvent(eventName)(target, propertyKey, descriptor);
    };
}
