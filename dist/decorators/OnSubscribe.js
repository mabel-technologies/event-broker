"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnSubscribe = OnSubscribe;
const event_emitter_1 = require("@tsed/event-emitter");
const LOG_PREFIX = "[event-broker]";
/**
 * Wrapper around @tsed/event-emitter's OnEvent.
 * Subscribes to events re-emitted from SQS and logs each listener invocation (event_id, listener name).
 */
function OnSubscribe(eventName) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (payload, ...args) {
            const eventId = typeof payload === "object" && payload !== null && "eventId" in payload
                ? payload.eventId
                : "unknown";
            console.info(`${LOG_PREFIX} Listener | event_id=${eventId} listener=${propertyKey}`);
            return originalMethod.apply(this, [payload, ...args]);
        };
        return (0, event_emitter_1.OnEvent)(eventName)(target, propertyKey, descriptor);
    };
}
