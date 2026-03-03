import { SqsConsumer } from "../consumer/SqsConsumer";
export declare class EventBrokerModule {
    private sqsConsumer;
    constructor(sqsConsumer: SqsConsumer);
    $onInit(): void;
    $onDestroy(): void;
}
