export interface OnSubscribeOptions {
    /**
     * Stable id for this handler; part of the dedup key. Unique per service — an event may have
     * any number of listeners, each with its own id, and each is deduplicated independently.
     * Set it explicitly (a class or method rename must not change it). Without it the decorator
     * falls back to `Class.method`.
     */
    id?: string;
    /** false = run on every delivery (heartbeat, pure metrics). Default true. */
    idempotent?: boolean;
}
export interface RegisteredHandler {
    eventName: string;
    handlerId: string;
    /** `Class.method` that declared it. */
    owner: string;
    idempotent: boolean;
}
export declare function registeredHandlers(): RegisteredHandler[];
/** For tests only. */
export declare function resetHandlerRegistry(): void;
/**
 * Subscribes to events from SQS, logs each invocation and — when `eventBroker.idempotency.mode`
 * is `shadow` or `enforce` — makes the listener idempotent per (service, eventId, handler id).
 *
 * Several listeners may subscribe to the same event, in one class or across classes. The consumer
 * acknowledges the message only when every listener resolved; a listener that failed is the only
 * one re-run on redelivery, because each keeps its own completion marker. Every failing listener
 * is logged individually (`listener_failed`), not just the first one the emitter reports.
 *
 * The wrapper is async so a synchronous throw becomes a rejection the consumer can see.
 */
export declare function OnSubscribe(eventName: string, opts?: OnSubscribeOptions): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => void | TypedPropertyDescriptor<any>;
