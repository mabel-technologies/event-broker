/** Subscribes to events from SQS and logs each listener invocation. */
export declare function OnSubscribe(eventName: string): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => void | TypedPropertyDescriptor<any>;
