import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { Configuration, Inject, Injectable } from "@tsed/di";
import type { DIConfiguration } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
import { v7 as uuid7 } from "uuid";
import { SnsMessageBody } from "../publisher/SnsPublisher.js";
import { EventBrokerConfig } from "../types/EventBrokerConfig.js";
import { NonRetryableEventError } from "../errors/EventErrors.js";

/** The subset of @tsed/event-emitter (eventemitter2) the consumer relies on. */
export interface EmitterLike {
  emitAsync(event: string, payload: unknown): Promise<unknown>;
  listenerCount?(event: string): number;
}

export type ConsumeOutcome = "acked" | "retry" | "poisoned" | "no_listener" | "malformed";

interface ParsedMessage {
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
}

const LOG = "[event-broker]";

@Injectable()
export class SqsConsumer {
  private client: SQSClient;
  private readonly config: EventBrokerConfig;
  private readonly serviceName: string;
  private readonly ackOnSuccess: boolean;
  private readonly visibilitySeconds: number;
  private polling = false;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private receiveBackoffMs = 0;
  private abort: AbortController | null = null;
  private readonly inFlight = new Map<Message, Promise<void>>();
  private currentPoll: Promise<void> | null = null;
  private listenerCountWarned = false;

  constructor(
    @Inject(EventEmitterService) private eventEmitter: EmitterLike,
    @Configuration() config: DIConfiguration,
  ) {
    const brokerConfig = config.get("eventBroker") as EventBrokerConfig | undefined;
    if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
      throw new Error(
        `${LOG} Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).`,
      );
    }
    this.config = brokerConfig;
    this.client = new SQSClient({ region: brokerConfig.region });
    this.serviceName = brokerConfig.serviceName ?? process.env.SERVICE_NAME ?? "unknown";
    this.ackOnSuccess = brokerConfig.sqs.ackOnSuccess === true;
    this.visibilitySeconds = brokerConfig.sqs.visibilityTimeoutSeconds ?? 30;
  }

  /**
   * Called by the module before start(). Throws so a service that cannot reach its queue fails
   * boot instead of polling nothing forever. Also refuses ackOnSuccess on a queue without a
   * dead-letter queue: a poison message would otherwise cycle until retention expires.
   */
  async assertReady(): Promise<void> {
    if (!this.config.sqs.enabled) return;
    if (!this.config.sqs.queueUrl) throw new Error(`${LOG} sqs.queueUrl is empty (sqs.enabled=true)`);
    const attrs = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.config.sqs.queueUrl,
        AttributeNames: ["QueueArn", "VisibilityTimeout", "RedrivePolicy"],
      }),
    );
    const live = Number(attrs.Attributes?.VisibilityTimeout ?? 0);
    if (live && live !== this.visibilitySeconds) {
      $log.warn(
        `${LOG} queue VisibilityTimeout=${live}s but config says ${this.visibilitySeconds}s; lease extension will use the wrong interval`,
      );
    }
    if (this.ackOnSuccess && !attrs.Attributes?.RedrivePolicy) {
      throw new Error(`${LOG} sqs.ackOnSuccess=true but the queue has no RedrivePolicy (dead-letter queue)`);
    }
  }

  start(): void {
    if (this.polling) {
      $log.info(`${LOG} SQS consumer already polling, skip start`);
      return;
    }
    if (!this.config.sqs.enabled) {
      $log.info(`${LOG} SQS polling disabled (sqs.enabled=false), not starting consumer`, {
        queueUrl: this.config.sqs.queueUrl,
        serviceName: this.serviceName,
      });
      return;
    }
    this.polling = true;
    $log.info(
      `${LOG} SQS consumer starting | service=${this.serviceName} ackOnSuccess=${this.ackOnSuccess} visibility=${this.visibilitySeconds}s maxMessages=${this.config.sqs.maxMessages ?? 10}`,
    );
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    this.pollTimeoutId = setTimeout(() => {
      this.pollTimeoutId = null;
      this.currentPoll = this.poll().finally(() => {
        this.currentPoll = null;
      });
    }, delayMs);
  }

  /** Stop polling, wait for in-flight handlers (capped), then hand back anything unfinished immediately. */
  async stop(): Promise<void> {
    this.polling = false;
    if (this.pollTimeoutId !== null) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
    this.abort?.abort();
    const cap = this.config.sqs.drainTimeoutMs ?? 25_000;
    // Wait for the poll iteration in progress (it releases any batch it receives after this point)
    // and for in-flight handlers, up to the cap.
    await Promise.race([
      Promise.allSettled([this.currentPoll ?? Promise.resolve(), ...this.inFlight.values()]),
      new Promise<void>((resolve) => setTimeout(resolve, cap)),
    ]);
    const released = this.inFlight.size;
    // Still running after the cap: make the message visible now rather than after the full
    // visibility timeout. The idempotency claim fences a concurrent re-run.
    await Promise.allSettled([...this.inFlight.keys()].map((m) => this.setVisibility(m, 0)));
    $log.info(`${LOG} SQS consumer stopped | service=${this.serviceName} released=${released}`);
  }

  private async poll(): Promise<void> {
    if (!this.polling || !this.config.sqs.enabled) return;

    let messages: Message[] = [];
    this.abort = new AbortController();
    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.config.sqs.queueUrl,
          MaxNumberOfMessages: this.config.sqs.maxMessages ?? 10,
          WaitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
          MessageAttributeNames: ["All"],
          MessageSystemAttributeNames: ["ApproximateReceiveCount"],
        }),
        { abortSignal: this.abort.signal },
      );
      messages = response.Messages ?? [];
      this.receiveBackoffMs = 0;
    } catch (err) {
      if (!this.polling) return; // aborted by stop()
      const error = err as Error & { name?: string; code?: string };
      this.receiveBackoffMs = Math.min(Math.max(this.receiveBackoffMs * 2, 1_000), 30_000);
      $log.warn(
        `${LOG} event.receive_failed | name=${error?.name ?? ""} code=${error?.code ?? ""} error=${error?.message ?? String(err)} | next poll in ${this.receiveBackoffMs}ms`,
      );
    }

    if (!this.polling && messages.length > 0) {
      // stop() raced with a completed receive: hand the batch straight back rather than handling it
      // with a consumer that is shutting down (or leaving it invisible for the full timeout).
      await Promise.allSettled(messages.map((m) => this.setVisibility(m, 0)));
      return;
    }

    // Serial by design; each message isolated so one failure cannot skip its batch-mates.
    for (const message of messages) {
      const run = this.handleMessage(message).catch((err: unknown) => {
        $log.error(`${LOG} event.consumer_bug | unexpected error outside the handler path: ${(err as Error)?.message ?? String(err)}`);
      });
      this.inFlight.set(message, run);
      try {
        await run;
      } finally {
        this.inFlight.delete(message);
      }
    }

    if (this.polling) this.schedule(this.receiveBackoffMs);
  }

  /** Exposed for tests. Processes one message exactly as the poll loop would. */
  async handleMessage(message: Message): Promise<void> {
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
    const parsed = this.parse(message);
    if (!parsed) {
      return this.reject(message, "malformed", { messageId: message.MessageId, receiveCount });
    }
    const { eventType, eventId, payload } = parsed;
    $log.info(`${LOG} Consume | eventName=${eventType} eventId=${eventId} receiveCount=${receiveCount}`);

    if (this.hasNoListener(eventType)) {
      return this.reject(message, "no_listener", { eventType, eventId, receiveCount });
    }

    if (!this.ackOnSuccess) {
      // Legacy path: same outcome as v1.0.x (delete regardless) with honest labels and counters.
      try {
        await this.runWithLease(message, eventType, () => this.eventEmitter.emitAsync(eventType, payload));
        this.count("acked", eventType);
      } catch (err) {
        this.logHandlerFailed(eventType, eventId, receiveCount, err, "shadow: deleted anyway");
        this.count("retry", eventType);
      } finally {
        await this.deleteMessage(message);
      }
      return;
    }

    try {
      await this.runWithLease(message, eventType, () => this.eventEmitter.emitAsync(eventType, payload));
      await this.deleteMessage(message);
      this.count("acked", eventType);
    } catch (err) {
      if (err instanceof NonRetryableEventError) {
        return this.reject(message, "poisoned", { eventType, eventId, receiveCount, error: err.message });
      }
      this.logHandlerFailed(eventType, eventId, receiveCount, err, "left on queue");
      this.count("retry", eventType);
      await this.backoff(message, receiveCount);
    }
  }

  private hasNoListener(eventType: string): boolean {
    const fn = this.eventEmitter.listenerCount;
    if (typeof fn !== "function") {
      if (!this.listenerCountWarned) {
        this.listenerCountWarned = true;
        $log.warn(`${LOG} event emitter has no listenerCount(); zero-listener guard disabled`);
      }
      return false;
    }
    return fn.call(this.eventEmitter, eventType) === 0;
  }

  /** Extend the lease at half the visibility timeout while the handler runs; warn, don't cancel, when it is slow. */
  private async runWithLease(message: Message, eventType: string, work: () => Promise<unknown>): Promise<void> {
    const everyMs = Math.max(5_000, (this.visibilitySeconds * 1000) / 2);
    const slowMs = this.config.sqs.handlerSlowMs ?? 60_000;
    const startedAt = Date.now();
    let warned = false;
    const timer = setInterval(() => {
      void this.setVisibility(message, this.visibilitySeconds).catch((err: unknown) => {
        $log.warn(`${LOG} event.lease_extend_failed | eventType=${eventType} error=${(err as Error)?.message}`);
      });
      if (!warned && Date.now() - startedAt > slowMs) {
        warned = true;
        $log.warn(`${LOG} event.handler_slow | eventType=${eventType} elapsedMs=${Date.now() - startedAt}`);
      }
    }, everyMs);
    try {
      await work();
    } finally {
      clearInterval(timer);
    }
  }

  /**
   * Never SendMessage to the DLQ: leave the message and let maxReceiveCount move it, so
   * console redrive keeps working. With ackOnSuccess off the message is still deleted, but the
   * outcome is counted so the would-be dead-letter rate is visible before the flip.
   */
  private async reject(message: Message, reason: Exclude<ConsumeOutcome, "acked" | "retry">, ctx: Record<string, unknown>): Promise<void> {
    this.count(reason, String(ctx.eventType ?? "unknown"));
    if (!this.ackOnSuccess) {
      $log.warn(`${LOG} event.${reason} | shadow: deleted`, ctx);
      return this.deleteMessage(message);
    }
    $log.warn(`${LOG} event.${reason} | left for redrive`, ctx);
    await this.setVisibility(message, 0);
  }

  private async backoff(message: Message, receiveCount: number): Promise<void> {
    const base = this.config.sqs.retryBaseSeconds ?? 10;
    const capped = Math.min(base * 2 ** Math.max(receiveCount - 1, 0), 900);
    const jittered = Math.max(1, Math.floor(capped * (0.5 + Math.random() * 0.5)));
    await this.setVisibility(message, jittered);
  }

  private parse(message: Message): ParsedMessage | null {
    const body = message.Body;
    if (!body) return null;
    let parsed: SnsMessageBody;
    try {
      const raw = JSON.parse(body) as Record<string, unknown>;
      parsed =
        typeof raw.Message === "string" && (raw.Type === "Notification" || "TopicArn" in raw)
          ? (JSON.parse(raw.Message) as unknown as SnsMessageBody)
          : (raw as unknown as SnsMessageBody);
    } catch {
      return null;
    }
    const eventType = parsed?.eventType ?? parsed?.event_type;
    if (!eventType || typeof eventType !== "string") return null;
    const eventId = parsed.event_id ?? uuid7();
    const { payload } = parsed;
    return {
      eventType,
      eventId,
      payload:
        typeof payload === "object" && payload !== null
          ? { ...(payload as Record<string, unknown>), eventId }
          : { eventId, data: payload },
    };
  }

  private logHandlerFailed(eventType: string, eventId: string, receiveCount: number, err: unknown, note: string): void {
    const e = err as Error;
    $log.error(
      `${LOG} event.handler_failed | eventName=${eventType} eventId=${eventId} receiveCount=${receiveCount} error=${e?.name ?? "Error"}: ${e?.message ?? String(err)} | ${note}`,
    );
  }

  /** One structured line per outcome; Loki counts these. */
  private count(outcome: ConsumeOutcome, eventType: string): void {
    $log.info({ metric: "event_outcome", outcome, eventType, service: this.serviceName, ackOnSuccess: this.ackOnSuccess });
  }

  private async setVisibility(message: Message, seconds: number): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.config.sqs.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }

  private async deleteMessage(message: Message): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.config.sqs.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}
