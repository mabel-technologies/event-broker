import { SNSClient, PublishCommand, PublishCommandInput } from "@aws-sdk/client-sns";
import { Inject, Injectable } from "@tsed/di";
import { v7 as uuid7 } from "uuid";
import { EventBrokerConfig } from "../types/EventBrokerConfig";

export const EVENT_BROKER_CONFIG = Symbol("EVENT_BROKER_CONFIG");

export interface SnsMessageBody {
  event_type: string;
  event_id?: string;
  payload: unknown;
}

/** Payload shape passed to @OnBrokerEvent handlers: original payload with eventId injected. */
export interface BrokerPayloadWithEventId<T = unknown> {
  eventId: string;
  data?: T;
  [key: string]: unknown;
}

@Injectable()
export class SnsPublisher {
  private client: SNSClient;

  constructor(@Inject(EVENT_BROKER_CONFIG) private config: EventBrokerConfig) {
    this.client = new SNSClient({ region: config.region });
  }

  async publish(eventType: string, payload: unknown): Promise<void> {
    const eventId = uuid7();
    const body: SnsMessageBody = {
      event_type: eventType,
      event_id: eventId,
      payload,
    };

    console.info(`[event-broker] Broadcast | event_id=${eventId} payload=${JSON.stringify(payload)}`);

    const input: PublishCommandInput = {
      TopicArn: this.config.sns.topicArn,
      Message: JSON.stringify(body),
      MessageAttributes: {
        event_type: {
          DataType: "String",
          StringValue: eventType,
        },
      },
    };

    await this.client.send(new PublishCommand(input));
  }
}
