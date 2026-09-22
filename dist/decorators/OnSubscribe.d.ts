export interface OnSubscribeOptions {
    /**
     * Stable id for this handler; part of the dedup key. Set it explicitly — a class or method
     * rename must not change it. Without it the decorator falls back to `Class.method`.
     */
    id?: string;
    /** false = run on every delivery (heartbeat, pure metrics). Default true. */
    idempotent?: boolean;
}
/**
 * Subscribes to events from SQS, logs each invocation and — when `eventBroker.idempotency.mode`
 * is `shadow` or `enforce` — makes the listener idempotent per (service, eventId, handler id).
 *
 * The wrapper is async so a synchronous throw becomes a rejection the consumer can see.
 */
export declare function OnSubscribe(eventName: string, opts?: OnSubscribeOptions): (target: object, propertyKey: string, descriptor: PropertyDescriptor) => void | TypedPropertyDescriptor<any>;
