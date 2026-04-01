import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { Configuration, Inject, Injectable } from "@tsed/di";
import type { DIConfiguration } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
import { v7 as uuid7 } from "uuid";
import { SnsMessageBody } from "../publisher/SnsPublisher.js";
import { EventBrokerConfig } from "../types/EventBrokerConfig.js";

@Injectable()
export class SqsConsumer {
  private client: SQSClient;
  private readonly config: EventBrokerConfig;
  private readonly serviceName: string;
  private polling = false;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(EventEmitterService) private eventEmitter: EventEmitterService,
    @Configuration() config: DIConfiguration
  ) {
    const brokerConfig = config.get("eventBroker") as EventBrokerConfig | undefined;
    if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
      throw new Error(
        '[event-broker] Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).'
      );
    }
    this.config = brokerConfig;
    this.client = new SQSClient({ region: brokerConfig.region });
    this.serviceName = process.env.SERVICE_NAME ?? "unknown";
  }

  start(): void {
    if (this.polling) {
      $log.info("[event-broker] SQS consumer already polling, skip start");
      return;
    }
    if (!this.config.sqs.enabled) {
      $log.info("[event-broker] SQS polling disabled (sqs.enabled=false), not starting consumer", {
        queueUrl: this.config.sqs.queueUrl,
        serviceName: this.serviceName,
      });
      return;
    }
    this.polling = true;
    $log.info("[event-broker] SQS consumer starting", {
      queueUrl: this.config.sqs.queueUrl,
      serviceName: this.serviceName,
      maxMessages: this.config.sqs.maxMessages ?? 10,
      waitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
    });
    this.poll();
  }

  stop(): void {
    this.polling = false;
    if (this.pollTimeoutId !== null) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    $log.info("[event-broker] SQS consumer stopped", { queueUrl: this.config.sqs.queueUrl, serviceName: this.serviceName });
  }

  private async poll(): Promise<void> {
    if (!this.polling || !this.config.sqs.enabled) {
      return;
    }

    try {
      $log.debug("[event-broker] SQS ReceiveMessage request", {
        queueUrl: this.config.sqs.queueUrl,
        serviceName: this.serviceName,
      });
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.config.sqs.queueUrl,
          MaxNumberOfMessages: this.config.sqs.maxMessages ?? 10,
          WaitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
          MessageAttributeNames: ["All"],
        })
      );

      const messages = response.Messages ?? [];
      if (messages.length > 0) {
        $log.info("[event-broker] SQS received messages", {
          count: messages.length,
          queueUrl: this.config.sqs.queueUrl,
          serviceName: this.serviceName,
          messageIds: messages.map((m) => m.MessageId).filter(Boolean),
        });
      }
      for (const message of messages) {
        await this.processMessage(message);
      }
    } catch (err) {
      const error = err as Error;
      //$log.error("[event-broker] SQS ReceiveMessage failed, will retry on next poll",this.config.sqs.queueUrl)
      // $log.warn("[event-broker] SQS ReceiveMessage failed, will retry on next poll", {
      //   queueUrl: this.config.sqs.queueUrl,
      //   serviceName: this.serviceName,
      //   error: error?.message,
      //   name: error?.name,
      // });
      // console.log({error});
    }

    if (this.polling) {
      this.pollTimeoutId = setTimeout(() => this.poll(), 0);
    }
  }

  private async processMessage(message: Message): Promise<void> {
    const body = message.Body;
    if (!body) {
      $log.warn("[event-broker] SQS message has no Body, deleting", {
        messageId: message.MessageId,
        queueUrl: this.config.sqs.queueUrl,
      });
      await this.deleteMessage(message);
      return;
    }

    let parsed: SnsMessageBody;
    try {
      const raw = JSON.parse(body) as Record<string, unknown>;
      if (typeof raw.Message === "string" && (raw.Type === "Notification" || "TopicArn" in raw)) {
        parsed = JSON.parse(raw.Message) as unknown as SnsMessageBody;
      } else {
        parsed = raw as unknown as SnsMessageBody;
      }
    } catch (parseErr) {
      $log.warn("[event-broker] SQS message Body is not valid JSON, deleting", {
        messageId: message.MessageId,
        queueUrl: this.config.sqs.queueUrl,
        error: (parseErr as Error)?.message,
      });
      await this.deleteMessage(message);
      return;
    }

    const parsedEventType = parsed.eventType ?? parsed.event_type;
    const { payload, event_id } = parsed;
    if (!parsedEventType) {
      $log.warn(`[event-broker] SQS message missing eventType, deleting | messageId=${message.MessageId ?? "n/a"} queueUrl=${this.config.sqs.queueUrl}`);
      await this.deleteMessage(message);
      return;
    }

    const eventId = event_id ?? uuid7();

    $log.info(`[event-broker] Event captured | event_id=${eventId} eventType=${parsedEventType} service_name=${this.serviceName} messageId=${message.MessageId ?? "n/a"}`);

    const payloadWithEventId =
      typeof payload === "object" && payload !== null
        ? { ...payload, eventId }
        : { eventId, data: payload };

    try {
      await this.eventEmitter.emitAsync(parsedEventType, payloadWithEventId);
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
