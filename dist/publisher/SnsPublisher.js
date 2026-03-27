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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnsPublisher = exports.EVENT_BROKER_CONFIG_OPTIONS = exports.EVENT_BROKER_CONFIG = void 0;
const client_sns_1 = require("@aws-sdk/client-sns");
const di_1 = require("@tsed/di");
const logger_1 = require("@tsed/logger");
const uuid_1 = require("uuid");
exports.EVENT_BROKER_CONFIG = Symbol("EVENT_BROKER_CONFIG");
/** @deprecated Use EventBrokerModule.forRoot(config) instead. */
exports.EVENT_BROKER_CONFIG_OPTIONS = Symbol("EVENT_BROKER_CONFIG_OPTIONS");
let SnsPublisher = class SnsPublisher {
    constructor(config) {
        const brokerConfig = config.get("eventBroker");
        if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
            throw new Error('[event-broker] Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).');
        }
        this.config = brokerConfig;
        this.client = new client_sns_1.SNSClient({ region: brokerConfig.region });
    }
    async publish(eventType, payload) {
        const topicArn = this.config.sns?.topicArn?.trim();
        if (!topicArn) {
            throw new Error('[event-broker] sns.topicArn is missing or empty. Set eventBroker.sns.topicArn in your @Configuration.');
        }
        const eventId = (0, uuid_1.v7)();
        const body = {
            eventType,
            event_id: eventId,
            payload,
        };
        logger_1.$log.info(`[event-broker] Broadcast | topic_arn=${topicArn} event_id=${eventId} eventType=${eventType} payload=${JSON.stringify(payload)}`);
        const input = {
            TopicArn: this.config.sns.topicArn,
            Message: JSON.stringify(body),
            MessageAttributes: {
                eventType: {
                    DataType: "String",
                    StringValue: eventType,
                },
            },
        };
        logger_1.$log.info(`[event-broker] Publish input | ${JSON.stringify({
            TopicArn: input.TopicArn,
            MessageAttributes: input.MessageAttributes,
            messageLength: input.Message?.length ?? 0,
        })}`);
        try {
            const result = await this.client.send(new client_sns_1.PublishCommand(input));
            logger_1.$log.info(`[event-broker] Publish success | result: ${JSON.stringify(result)}`);
        }
        catch (err) {
            const error = err;
            logger_1.$log.warn(`[event-broker] Publish failed | topicArn=${topicArn} eventId=${eventId} eventType=${eventType} error=${error?.message} name=${error?.name}`);
            throw err;
        }
    }
};
exports.SnsPublisher = SnsPublisher;
exports.SnsPublisher = SnsPublisher = __decorate([
    (0, di_1.Injectable)(),
    __param(0, (0, di_1.Configuration)()),
    __metadata("design:paramtypes", [Function])
], SnsPublisher);
