import { SnsPublisher } from "../publisher/SnsPublisher.js";
import { SqsConsumer } from "../consumer/SqsConsumer.js";
export declare class EventBrokerModule {
    private sqsConsumer;
    private snsPublisher;
    constructor(sqsConsumer: SqsConsumer, snsPublisher: SnsPublisher);
    /**
     * Optional: use when not using Ts.ED Configuration eventBroker key.
     * With Ts.ED Configuration approach, add eventBroker to @Configuration({ eventBroker: {...} }) and use imports: [EventBrokerModule].
     */
    static forRoot(_config: import("../types/EventBrokerConfig.js").EventBrokerConfig): [typeof EventBrokerModule];
    /** Validate the topic and queue before polling: a service that cannot reach them must not report healthy. */
    $onInit(): Promise<void>;
    /** Returns the promise so Ts.ED waits for the drain. */
    $onDestroy(): Promise<void>;
}
