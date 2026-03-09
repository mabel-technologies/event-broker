import { Inject, Module } from "@tsed/di";
import { EventEmitterModule } from "@tsed/event-emitter";
import { EVENT_BROKER_CONFIG } from "../publisher/SnsPublisher";
import { SnsPublisher } from "../publisher/SnsPublisher";
import { SqsConsumer } from "../consumer/SqsConsumer";
import { EventBrokerService } from "../services/EventBrokerService";

@Module({
  imports: [EventEmitterModule],
  providers: [SnsPublisher, SqsConsumer, EventBrokerService],
})
export class EventBrokerModule {
  constructor(@Inject(SqsConsumer) private sqsConsumer: SqsConsumer) {}

  $onInit(): void {
    this.sqsConsumer.start();
  }

  $onDestroy(): void {
    this.sqsConsumer.stop();
  }
}
