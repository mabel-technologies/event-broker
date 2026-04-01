import { SnsPublisher } from "../publisher/SnsPublisher.js";
export declare class EventBrokerService {
    private publisher;
    constructor(publisher: SnsPublisher);
    publish(eventType: string, payload: unknown): Promise<void>;
}
