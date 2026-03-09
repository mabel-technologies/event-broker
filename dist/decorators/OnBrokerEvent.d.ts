/**
 * Wrapper around @tsed/event-emitter's OnEvent.
 * Subscribes to events re-emitted from SQS and logs each listener invocation (event_id, listener name).
 */
export declare function OnBrokerEvent(eventName: string): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => void | TypedPropertyDescriptor<any>;
