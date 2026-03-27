"use strict";
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqsConsumer = void 0;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const di_1 = require("@tsed/di");
const event_emitter_1 = require("@tsed/event-emitter");
const logger_1 = require("@tsed/logger");
const uuid_1 = require("uuid");
let SqsConsumer = class SqsConsumer {
    constructor(eventEmitter, config) {
        this.eventEmitter = eventEmitter;
        this.polling = false;
        this.pollTimeoutId = null;
        const brokerConfig = config.get("eventBroker");
        if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
            throw new Error('[event-broker] Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).');
        }
        this.config = brokerConfig;
        this.client = new client_sqs_1.SQSClient({ region: brokerConfig.region });
        this.serviceName = process.env.SERVICE_NAME ?? "unknown";
    }
    start() {
        if (this.polling) {
            logger_1.$log.info("[event-broker] SQS consumer already polling, skip start");
            return;
        }
        if (!this.config.sqs.enabled) {
            logger_1.$log.info("[event-broker] SQS polling disabled (sqs.enabled=false), not starting consumer", {
                queueUrl: this.config.sqs.queueUrl,
                serviceName: this.serviceName,
            });
            return;
        }
        this.polling = true;
        logger_1.$log.info("[event-broker] SQS consumer starting", {
            queueUrl: this.config.sqs.queueUrl,
            serviceName: this.serviceName,
            maxMessages: this.config.sqs.maxMessages ?? 10,
            waitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
        });
        this.poll();
    }
    stop() {
        this.polling = false;
        if (this.pollTimeoutId !== null) {
            clearTimeout(this.pollTimeoutId);
            this.pollTimeoutId = null;
        }
        logger_1.$log.info("[event-broker] SQS consumer stopped", { queueUrl: this.config.sqs.queueUrl, serviceName: this.serviceName });
    }
    async poll() {
        if (!this.polling || !this.config.sqs.enabled) {
            return;
        }
        try {
            logger_1.$log.debug("[event-broker] SQS ReceiveMessage request", {
                queueUrl: this.config.sqs.queueUrl,
                serviceName: this.serviceName,
            });
            const response = await this.client.send(new client_sqs_1.ReceiveMessageCommand({
                QueueUrl: this.config.sqs.queueUrl,
                MaxNumberOfMessages: this.config.sqs.maxMessages ?? 10,
                WaitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
                MessageAttributeNames: ["All"],
            }));
            const messages = response.Messages ?? [];
            if (messages.length > 0) {
                logger_1.$log.info("[event-broker] SQS received messages", {
                    count: messages.length,
                    queueUrl: this.config.sqs.queueUrl,
                    serviceName: this.serviceName,
                    messageIds: messages.map((m) => m.MessageId).filter(Boolean),
                });
            }
            for (const message of messages) {
                await this.processMessage(message);
            }
        }
        catch (err) {
            const error = err;
            logger_1.$log.warn("[event-broker] SQS ReceiveMessage failed, will retry on next poll", {
                queueUrl: this.config.sqs.queueUrl,
                serviceName: this.serviceName,
                error: error?.message,
                name: error?.name,
            });
        }
        if (this.polling) {
            this.pollTimeoutId = setTimeout(() => this.poll(), 0);
        }
    }
    async processMessage(message) {
        const body = message.Body;
        if (!body) {
            logger_1.$log.warn("[event-broker] SQS message has no Body, deleting", {
                messageId: message.MessageId,
                queueUrl: this.config.sqs.queueUrl,
            });
            await this.deleteMessage(message);
            return;
        }
        let parsed;
        try {
            const raw = JSON.parse(body);
            if (typeof raw.Message === "string" && (raw.Type === "Notification" || "TopicArn" in raw)) {
                parsed = JSON.parse(raw.Message);
            }
            else {
                parsed = raw;
            }
        }
        catch (parseErr) {
            logger_1.$log.warn("[event-broker] SQS message Body is not valid JSON, deleting", {
                messageId: message.MessageId,
                queueUrl: this.config.sqs.queueUrl,
                error: parseErr?.message,
            });
            await this.deleteMessage(message);
            return;
        }
        const parsedEventType = parsed.eventType ?? parsed.event_type;
        const { payload, event_id } = parsed;
        if (!parsedEventType) {
            logger_1.$log.warn(`[event-broker] SQS message missing eventType, deleting | messageId=${message.MessageId ?? "n/a"} queueUrl=${this.config.sqs.queueUrl}`);
            await this.deleteMessage(message);
            return;
        }
        const eventId = event_id ?? (0, uuid_1.v7)();
        logger_1.$log.info(`[event-broker] Event captured | event_id=${eventId} eventType=${parsedEventType} service_name=${this.serviceName} messageId=${message.MessageId ?? "n/a"}`);
        const payloadWithEventId = typeof payload === "object" && payload !== null
            ? { ...payload, eventId }
            : { eventId, data: payload };
        try {
            await this.eventEmitter.emitAsync(parsedEventType, payloadWithEventId);
        }
        finally {
            await this.deleteMessage(message);
        }
    }
    async deleteMessage(message) {
        if (!message.ReceiptHandle)
            return;
        await this.client.send(new client_sqs_1.DeleteMessageCommand({
            QueueUrl: this.config.sqs.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
        }));
    }
};
exports.SqsConsumer = SqsConsumer;
exports.SqsConsumer = SqsConsumer = __decorate([
    (0, di_1.Injectable)(),
    __param(0, (0, di_1.Inject)(event_emitter_1.EventEmitterService)),
    __param(1, (0, di_1.Configuration)()),
    __metadata("design:paramtypes", [typeof (_a = typeof event_emitter_1.EventEmitterService !== "undefined" && event_emitter_1.EventEmitterService) === "function" ? _a : Object, Function])
], SqsConsumer);
