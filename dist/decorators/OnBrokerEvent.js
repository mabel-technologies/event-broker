"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnBrokerEvent = OnBrokerEvent;
const event_emitter_1 = require("@tsed/event-emitter");
/**
 * Wrapper around @tsed/event-emitter's OnEvent.
 * Use to subscribe to events re-emitted from SQS by the Event Broker.
 */
function OnBrokerEvent(eventName) {
    return (0, event_emitter_1.OnEvent)(eventName);
}
