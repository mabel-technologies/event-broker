import { OnEvent } from "@tsed/event-emitter";

/**
 * Wrapper around @tsed/event-emitter's OnEvent.
 * Use to subscribe to events re-emitted from SQS by the Event Broker.
 */
export function OnBrokerEvent(eventName: string) {
  return OnEvent(eventName);
}
