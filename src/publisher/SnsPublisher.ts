import { SNSClient, PublishCommand, PublishCommandInput } from "@aws-sdk/client-sns";
import { Inject, Injectable } from "@tsed/di";
import { EventBrokerConfig } from "../types/EventBrokerConfig";

export const EVENT_BROKER_CONFIG = Symbol("EVENT_BROKER_CONFIG");

export interface SnsMessageBody {
  event_type: string;
  payload: unknown;
}

@Injectable()
export class SnsPublisher {
  private client: SNSClient;

  constructor(@Inject(EVENT_BROKER_CONFIG) private config: EventBrokerConfig) {
    this.client = new SNSClient({ region: config.region });
  }

  async publish(eventType: string, payload: unknown): Promise<void> {
    const body: SnsMessageBody = {
      event_type: eventType,
      payload,
    };

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
