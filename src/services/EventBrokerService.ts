import { Inject, Injectable } from "@tsed/di";
import { SnsPublisher } from "../publisher/SnsPublisher.js";

@Injectable()
export class EventBrokerService {
  constructor(@Inject(SnsPublisher) private publisher: SnsPublisher) {}

  async publish(eventType: string, payload: unknown): Promise<void> {
    await this.publisher.publish(eventType, payload);
  }
}
