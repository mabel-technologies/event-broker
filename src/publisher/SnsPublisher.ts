import { SNSClient, PublishCommand, PublishCommandInput } from "@aws-sdk/client-sns";
import { Configuration, Injectable } from "@tsed/di";
import type { DIConfiguration } from "@tsed/di";
import { $log } from "@tsed/logger";
import { EventBrokerConfig } from "../types/EventBrokerConfig.js";

function extractEventIdFromPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("[event-broker] publish: payload must be an object with eventId.");
  }
  const { eventId } = payload as { eventId?: unknown };
  if (typeof eventId === "string" && eventId.trim() !== "") {
    return eventId.trim();
  }
  throw new Error("[event-broker] publish: payload.eventId must be a non-empty string.");
}

export const EVENT_BROKER_CONFIG = Symbol("EVENT_BROKER_CONFIG");

/** @deprecated Use EventBrokerModule.forRoot(config) instead. */
export const EVENT_BROKER_CONFIG_OPTIONS = Symbol("EVENT_BROKER_CONFIG_OPTIONS");

export interface SnsMessageBody {
  eventType: string;
  /** @deprecated Use eventType. Accepted for backward compatibility with old messages. */
  event_type?: string;
  event_id?: string;
  payload: unknown;
}

/** Payload passed to @OnSubscribe handlers: original payload with eventId injected. */
export interface BrokerPayloadWithEventId<T = unknown> {
  eventId: string;
  data?: T;
  [key: string]: unknown;
}

@Injectable()
export class SnsPublisher {
  private client: SNSClient;
  private readonly config: EventBrokerConfig;

  constructor(@Configuration() config: DIConfiguration) {
    const brokerConfig = config.get("eventBroker") as EventBrokerConfig | undefined;
    if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
      throw new Error(
        '[event-broker] Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).'
      );
    }
    this.config = brokerConfig;
    this.client = new SNSClient({ region: brokerConfig.region });
  }

  async publish(eventType: string, payload: unknown): Promise<void> {
    const topicArn = this.config.sns?.topicArn?.trim();
    if (!topicArn) {
      throw new Error(
        '[event-broker] sns.topicArn is missing or empty. Set eventBroker.sns.topicArn in your @Configuration.'
      );
    }

    const eventId = extractEventIdFromPayload(payload);
    const body: SnsMessageBody = {
      eventType,
      event_id: eventId,
      payload,
    };

    $log.info(`[event-broker] Publish | eventName=${eventType} eventId=${eventId}`);

    const input: PublishCommandInput = {
      TopicArn: this.config.sns.topicArn,
      Message: JSON.stringify(body),
      MessageAttributes: {
        eventType: {
          DataType: "String",
          StringValue: eventType,
        },
      },
    };

    try {
      await this.client.send(new PublishCommand(input));
    } catch (err) {
      const error = err as Error;
      $log.warn(`[event-broker] Publish failed | eventName=${eventType} eventId=${eventId} error=${error?.message}`);
      throw err;
    }
  }
}
