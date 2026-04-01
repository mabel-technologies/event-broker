import { SqsConsumer } from "../consumer/SqsConsumer.js";
export declare class EventBrokerModule {
    private sqsConsumer;
    constructor(sqsConsumer: SqsConsumer);
    /**
     * Optional: use when not using Ts.ED Configuration eventBroker key.
     * With Ts.ED Configuration approach, add eventBroker to @Configuration({ eventBroker: {...} }) and use imports: [EventBrokerModule].
     */
    static forRoot(_config: import("../types/EventBrokerConfig.js").EventBrokerConfig): [typeof EventBrokerModule];
    $onInit(): void;
    $onDestroy(): void;
}
