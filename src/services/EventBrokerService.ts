import { Inject, Injectable } from "@tsed/di";
import { SnsPublisher } from "../publisher/SnsPublisher";

@Injectable()
export class EventBrokerService {
  constructor(@Inject(SnsPublisher) private publisher: SnsPublisher) {}

  async eventBroadcast(eventType: string, payload: unknown): Promise<void> {
    await this.publisher.publish(eventType, payload);
  }
}
