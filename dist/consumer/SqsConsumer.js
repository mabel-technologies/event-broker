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
const SnsPublisher_1 = require("../publisher/SnsPublisher");
let SqsConsumer = class SqsConsumer {
    constructor(config, eventEmitter) {
        this.config = config;
        this.eventEmitter = eventEmitter;
        this.polling = false;
        this.pollTimeoutId = null;
        this.client = new client_sqs_1.SQSClient({ region: config.region });
        this.serviceName = process.env.SERVICE_NAME ?? "unknown";
    }
    start() {
        if (!this.config.sqs.enabled) {
            return;
        }
        if (this.polling) {
            return;
        }
        this.polling = true;
        this.poll();
    }
    stop() {
        this.polling = false;
        if (this.pollTimeoutId !== null) {
            clearTimeout(this.pollTimeoutId);
            this.pollTimeoutId = null;
        }
    }
    async poll() {
        if (!this.polling || !this.config.sqs.enabled) {
            return;
        }
        try {
            const response = await this.client.send(new client_sqs_1.ReceiveMessageCommand({
                QueueUrl: this.config.sqs.queueUrl,
                MaxNumberOfMessages: this.config.sqs.maxMessages ?? 10,
                WaitTimeSeconds: this.config.sqs.pollingWaitTimeSeconds ?? 20,
                MessageAttributeNames: ["All"],
            }));
            const messages = response.Messages ?? [];
            for (const message of messages) {
                await this.processMessage(message);
            }
        }
        catch {
            // Continue polling on error; next iteration will retry
        }
        if (this.polling) {
            this.pollTimeoutId = setTimeout(() => this.poll(), 0);
        }
    }
    async processMessage(message) {
        const body = message.Body;
        if (!body) {
            await this.deleteMessage(message);
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            await this.deleteMessage(message);
            return;
        }
        const { event_type, payload, event_id } = parsed;
        if (!event_type) {
            await this.deleteMessage(message);
            return;
        }
        const eventId = event_id ?? (0, uuid_1.v7)();
        logger_1.$log.info(`[event-broker] Event captured | event_id=${eventId} service_name=${this.serviceName}`);
        const payloadWithEventId = typeof payload === "object" && payload !== null
            ? { ...payload, eventId }
            : { eventId, data: payload };
        try {
            await this.eventEmitter.emitAsync(event_type, payloadWithEventId);
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
    __param(0, (0, di_1.Inject)(SnsPublisher_1.EVENT_BROKER_CONFIG)),
    __param(1, (0, di_1.Inject)(event_emitter_1.EventEmitterService)),
    __metadata("design:paramtypes", [Object, typeof (_a = typeof event_emitter_1.EventEmitterService !== "undefined" && event_emitter_1.EventEmitterService) === "function" ? _a : Object])
], SqsConsumer);
