var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ChangeMessageVisibilityCommand, DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient, } from "@aws-sdk/client-sqs";
import { Configuration, Inject, Injectable } from "@tsed/di";
import { EventEmitterService } from "@tsed/event-emitter";
import { $log } from "@tsed/logger";
import { v7 as uuid7 } from "uuid";
import { NonRetryableEventError } from "../errors/NonRetryableEventError.js";
const RECEIVE_BACKOFF_MIN_MS = 1000;
const RECEIVE_BACKOFF_MAX_MS = 30000;
const HANDLER_BACKOFF_MIN_SEC = 10;
const HANDLER_BACKOFF_MAX_SEC = 900;
const DRAIN_TIMEOUT_MS = 25000;
let SqsConsumer = class SqsConsumer {
    constructor(eventEmitter, config) {
        this.eventEmitter = eventEmitter;
        this.polling = false;
        this.pollTimeoutId = null;
        this.receiveBackoffMs = 0;
        this.inFlight = new Set();
        const brokerConfig = config.get("eventBroker");
        if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
            throw new Error("[event-broker] Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).");
        }
        if (!brokerConfig.sqs.queueUrl?.trim()) {
            throw new Error("[event-broker] sqs.queueUrl is missing or empty.");
        }
        this.config = brokerConfig;
        this.client = new SQSClient({ region: brokerConfig.region });
        this.serviceName = process.env.SERVICE_NAME ?? "unknown";
    }
    async start() {
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
        await this.assertQueueReachable();
        this.polling = true;
        $log.info("[event-broker] SQS consumer starting");
        this.poll();
    }
    async assertQueueReachable() {
        try {
            await this.client.send(new GetQueueAttributesCommand({
                QueueUrl: this.config.sqs.queueUrl,
                AttributeNames: ["QueueArn"],
            }));
        }
        catch (err) {
            const error = err;
            throw new Error(`[event-broker] SQS queue unreachable at startup | queueUrl=${this.config.sqs.queueUrl} error=${error?.message}`);
        }
    }
    async stop() {
        this.polling = false;
        if (this.pollTimeoutId !== null) {
            clearTimeout(this.pollTimeoutId);
            this.pollTimeoutId = null;
        }
        const inFlightCount = this.inFlight.size;
        await Promise.race([
            Promise.allSettled([...this.inFlight]),
            new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS)),
        ]);
        $log.info("[event-broker] SQS consumer stopped", {
            queueUrl: this.config.sqs.queueUrl,
            serviceName: this.serviceName,
            inFlightAtStop: inFlightCount,
        });
    }
    async poll() {
        if (!this.polling || !this.config.sqs.enabled) {
            return;
        }
        try {
            const response = await this.client.send(new ReceiveMessageCommand({
                QueueUrl: this.config.sqs.queueUrl,
                MaxNumberOfMessages: this.config.sqs.maxMessages ?? 10,
                WaitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
                MessageAttributeNames: ["All"],
                MessageSystemAttributeNames: ["ApproximateReceiveCount"],
            }));
            this.receiveBackoffMs = 0;
            const messages = response.Messages ?? [];
            for (const message of messages) {
                const task = this.processMessage(message);
                this.inFlight.add(task);
                try {
                    await task;
                }
                catch (err) {
                    // processMessage isolates handler failures internally; a rejection here means the
                    // isolation logic itself broke, which must not take the rest of the batch down with it.
                    $log.error(`[event-broker] event.processing_crashed | messageId=${message.MessageId ?? "n/a"} error=${err?.message}`);
                }
                finally {
                    this.inFlight.delete(task);
                }
            }
        }
        catch (err) {
            const error = err;
            $log.warn(`[event-broker] event.receive_failed | name=${error?.name ?? ""} code=${error?.code ?? ""} error=${error?.message ?? String(err)}`);
            this.receiveBackoffMs =
                this.receiveBackoffMs > 0
                    ? Math.min(this.receiveBackoffMs * 2, RECEIVE_BACKOFF_MAX_MS)
                    : RECEIVE_BACKOFF_MIN_MS;
        }
        if (this.polling) {
            this.pollTimeoutId = setTimeout(() => this.poll(), this.receiveBackoffMs);
        }
    }
    async processMessage(message) {
        const body = message.Body;
        if (!body) {
            await this.rejectOrDelete(message, "missing_body", "SQS message has no Body");
            return;
        }
        let parsed;
        try {
            const raw = JSON.parse(body);
            parsed =
                typeof raw.Message === "string" && (raw.Type === "Notification" || "TopicArn" in raw)
                    ? JSON.parse(raw.Message)
                    : raw;
        }
        catch (parseErr) {
            await this.rejectOrDelete(message, "invalid_json", `SQS message Body is not valid JSON: ${parseErr?.message}`);
            return;
        }
        const parsedEventType = parsed.eventType ?? parsed.event_type;
        const { payload, event_id } = parsed;
        if (!parsedEventType) {
            await this.rejectOrDelete(message, "missing_event_type", "SQS message missing eventType");
            return;
        }
        const eventId = event_id ?? uuid7();
        $log.info(`[event-broker] Consume | eventName=${parsedEventType} eventId=${eventId}`);
        const payloadWithEventId = typeof payload === "object" && payload !== null
            ? { ...payload, eventId }
            : { eventId, data: payload };
        if (this.eventEmitter.listenerCount(parsedEventType) === 0) {
            await this.rejectOrDelete(message, "no_listener_registered", `no @OnSubscribe listener for ${parsedEventType}`);
            return;
        }
        try {
            await this.eventEmitter.emitAsync(parsedEventType, payloadWithEventId);
            await this.deleteMessage(message);
        }
        catch (err) {
            await this.handleHandlerFailure(message, parsedEventType, eventId, err);
        }
    }
    /** No-DLQ-yet-safe rejection path for poison/unlistened messages: deletes unconditionally
     * unless ackOnSuccess is on, matching processMessage's success/failure gating below. */
    async rejectOrDelete(message, reason, detail) {
        $log.warn(`[event-broker] event.poisoned | reason=${reason} messageId=${message.MessageId ?? "n/a"} queueUrl=${this.config.sqs.queueUrl} detail=${detail}`);
        if (this.config.sqs.ackOnSuccess) {
            await this.rejectToDlq(message);
        }
        else {
            await this.deleteMessage(message);
        }
    }
    async handleHandlerFailure(message, eventType, eventId, err) {
        const error = err;
        if (!this.config.sqs.ackOnSuccess) {
            $log.warn(`[event-broker] event.handler_failed | eventName=${eventType} eventId=${eventId} error=${error?.message}`);
            await this.deleteMessage(message);
            return;
        }
        if (error instanceof NonRetryableEventError) {
            $log.warn(`[event-broker] event.poisoned | reason=non_retryable eventName=${eventType} eventId=${eventId} error=${error.message}`);
            await this.rejectToDlq(message);
            return;
        }
        $log.warn(`[event-broker] event.handler_failed | eventName=${eventType} eventId=${eventId} error=${error?.message}`);
        const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
        await this.backoff(message, receiveCount);
    }
    /** Leaves the message undeleted with zero visibility so it's immediately eligible for
     * redelivery; once the queue has a RedrivePolicy, maxReceiveCount carries it to the DLQ with
     * its source intact. Sending it to a DLQ by hand instead would break native one-click redrive. */
    async rejectToDlq(message) {
        if (!message.ReceiptHandle)
            return;
        await this.client.send(new ChangeMessageVisibilityCommand({
            QueueUrl: this.config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: 0,
        }));
    }
    async backoff(message, receiveCount) {
        if (!message.ReceiptHandle)
            return;
        const capped = Math.min(HANDLER_BACKOFF_MIN_SEC * 2 ** (receiveCount - 1), HANDLER_BACKOFF_MAX_SEC);
        const jittered = Math.floor(capped * (0.5 + Math.random() * 0.5));
        await this.client.send(new ChangeMessageVisibilityCommand({
            QueueUrl: this.config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: jittered,
        }));
    }
    async deleteMessage(message) {
        if (!message.ReceiptHandle)
            return;
        await this.client.send(new DeleteMessageCommand({
            QueueUrl: this.config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
        }));
    }
};
SqsConsumer = __decorate([
    Injectable(),
    __param(0, Inject(EventEmitterService)),
    __param(1, Configuration()),
    __metadata("design:paramtypes", [EventEmitterService, Function])
], SqsConsumer);
export { SqsConsumer };
