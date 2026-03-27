/** Subscribes to events from SQS and logs each listener invocation (event_id, listener name). */
export declare function OnSubscribe(eventName: string): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => void | TypedPropertyDescriptor<any>;
