import { Inject, Module } from "@tsed/di";
import { EventEmitterModule } from "@tsed/event-emitter";
import { SnsPublisher } from "../publisher/SnsPublisher.js";
import { SqsConsumer } from "../consumer/SqsConsumer.js";
import { EventBrokerService } from "../services/EventBrokerService.js";

@Module({
  imports: [EventEmitterModule],
  providers: [SnsPublisher, SqsConsumer, EventBrokerService],
})
export class EventBrokerModule {
  constructor(@Inject(SqsConsumer) private sqsConsumer: SqsConsumer) {}

  /**
   * Optional: use when not using Ts.ED Configuration eventBroker key.
   * With Ts.ED Configuration approach, add eventBroker to @Configuration({ eventBroker: {...} }) and use imports: [EventBrokerModule].
   */
  static forRoot(_config: import("../types/EventBrokerConfig.js").EventBrokerConfig): [typeof EventBrokerModule] {
    return [EventBrokerModule];
  }

  $onInit(): Promise<void> {
    return this.sqsConsumer.start();
  }

  $onDestroy(): Promise<void> {
    return this.sqsConsumer.stop();
  }
}
