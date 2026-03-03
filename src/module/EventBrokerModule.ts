import { DIConfiguration, Inject, Module } from "@tsed/di";
import { EventEmitterModule } from "@tsed/event-emitter";
import { EVENT_BROKER_CONFIG } from "../publisher/SnsPublisher";
import { SnsPublisher } from "../publisher/SnsPublisher";
import { SqsConsumer } from "../consumer/SqsConsumer";
import { EventBrokerService } from "../services/EventBrokerService";
import { EventBrokerConfig } from "../types/EventBrokerConfig";

@Module({
  imports: [EventEmitterModule],
  providers: [
    {
      provide: EVENT_BROKER_CONFIG,
      useFactory: (config: DIConfiguration) => {
        const eventBroker = config.get<EventBrokerConfig>("eventBroker");
        if (!eventBroker) {
          throw new Error(
            'EventBrokerModule requires "eventBroker" in Ts.ED configuration'
          );
        }
        return eventBroker;
      },
      deps: [DIConfiguration],
    },
    SnsPublisher,
    SqsConsumer,
    EventBrokerService,
  ],
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
