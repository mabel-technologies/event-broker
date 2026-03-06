import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
import { v7 as uuid7 } from "uuid";
import { EVENT_BROKER_CONFIG, SnsMessageBody } from "../publisher/SnsPublisher";
import { EventBrokerConfig } from "../types/EventBrokerConfig";

@Injectable()
export class SqsConsumer {
  private client: SQSClient;
  private readonly serviceName: string;
  private polling = false;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(EVENT_BROKER_CONFIG) private config: EventBrokerConfig,
    @Inject(EventEmitterService) private eventEmitter: EventEmitterService
  ) {
    this.client = new SQSClient({ region: config.region });
    this.serviceName = process.env.SERVICE_NAME ?? "unknown";
  }

  start(): void {
    if (!this.config.sqs.enabled) {
      return;
    }
    if (this.polling) {
      return;
    }
    this.polling = true;
    this.poll();
  }

  stop(): void {
    this.polling = false;
    if (this.pollTimeoutId !== null) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.polling || !this.config.sqs.enabled) {
      return;
    }

    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.config.sqs.queueUrl,
          MaxNumberOfMessages: this.config.sqs.maxMessages ?? 10,
          WaitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
          MessageAttributeNames: ["All"],
        })
      );

      const messages = response.Messages ?? [];
      for (const message of messages) {
        await this.processMessage(message);
      }
    } catch {
      // Continue polling on error; next iteration will retry
    }

    if (this.polling) {
      this.pollTimeoutId = setTimeout(() => this.poll(), 0);
    }
  }

  private async processMessage(message: Message): Promise<void> {
    const body = message.Body;
    if (!body) {
      await this.deleteMessage(message);
      return;
    }

    let parsed: SnsMessageBody;
    try {
      parsed = JSON.parse(body) as SnsMessageBody;
    } catch {
      await this.deleteMessage(message);
      return;
    }

    const { event_type, payload, event_id } = parsed;
    if (!event_type) {
      await this.deleteMessage(message);
      return;
    }

    const eventId = event_id ?? uuid7();

    $log.info(`[event-broker] Event captured | event_id=${eventId} service_name=${this.serviceName}`);

    const payloadWithEventId =
      typeof payload === "object" && payload !== null
        ? { ...payload, eventId }
        : { eventId, data: payload };

    try {
      await this.eventEmitter.emitAsync(event_type, payloadWithEventId);
    } finally {
      await this.deleteMessage(message);
    }
  }

  private async deleteMessage(message: Message): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.sqs.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      })
    );
  }
}
