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
  constructor(
    @Inject(SqsConsumer) private sqsConsumer: SqsConsumer,
    @Inject(SnsPublisher) private snsPublisher: SnsPublisher,
  ) {}

  /**
   * Optional: use when not using Ts.ED Configuration eventBroker key.
   * With Ts.ED Configuration approach, add eventBroker to @Configuration({ eventBroker: {...} }) and use imports: [EventBrokerModule].
   */
  static forRoot(_config: import("../types/EventBrokerConfig.js").EventBrokerConfig): [typeof EventBrokerModule] {
    return [EventBrokerModule];
  }

  /** Validate the topic and queue before polling: a service that cannot reach them must not report healthy. */
  async $onInit(): Promise<void> {
    await this.snsPublisher.assertReady();
    await this.sqsConsumer.assertReady();
    this.sqsConsumer.start();
  }

  /** Returns the promise so Ts.ED waits for the drain. */
  $onDestroy(): Promise<void> {
    return this.sqsConsumer.stop();
  }
}
