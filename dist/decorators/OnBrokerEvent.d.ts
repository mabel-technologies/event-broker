/**
 * Wrapper around @tsed/event-emitter's OnEvent.
 * Use to subscribe to events re-emitted from SQS by the Event Broker.
 */
export declare function OnBrokerEvent(eventName: string): MethodDecorator;
