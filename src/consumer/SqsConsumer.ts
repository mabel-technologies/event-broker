import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
import { EVENT_BROKER_CONFIG, SnsMessageBody } from "../publisher/SnsPublisher";
import { EventBrokerConfig } from "../types/EventBrokerConfig";

@Injectable()
export class SqsConsumer {
  private client: SQSClient;
  private polling = false;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(EVENT_BROKER_CONFIG) private config: EventBrokerConfig,
    @Inject(EventEmitterService) private eventEmitter: EventEmitterService
  ) {
    this.client = new SQSClient({ region: config.region });
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

    const { event_type, payload } = parsed;
    if (!event_type) {
      await this.deleteMessage(message);
      return;
    }

    try {
      await this.eventEmitter.emitAsync(event_type, payload);
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
