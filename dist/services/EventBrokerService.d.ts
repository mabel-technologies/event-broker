import { SnsPublisher } from "../publisher/SnsPublisher";
export declare class EventBrokerService {
    private publisher;
    constructor(publisher: SnsPublisher);
    eventBroadcast(eventType: string, payload: unknown): Promise<void>;
}
