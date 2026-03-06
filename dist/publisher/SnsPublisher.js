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
exports.SnsPublisher = exports.EVENT_BROKER_CONFIG = void 0;
const client_sns_1 = require("@aws-sdk/client-sns");
const di_1 = require("@tsed/di");
const logger_1 = require("@tsed/logger");
const uuid_1 = require("uuid");
exports.EVENT_BROKER_CONFIG = Symbol("EVENT_BROKER_CONFIG");
let SnsPublisher = class SnsPublisher {
    constructor(config) {
        this.config = config;
        this.client = new client_sns_1.SNSClient({ region: config.region });
    }
    async publish(eventType, payload) {
        const eventId = (0, uuid_1.v7)();
        const body = {
            event_type: eventType,
            event_id: eventId,
            payload,
        };
        logger_1.$log.info(`[event-broker] Broadcast | event_id=${eventId} payload=${JSON.stringify(payload)}`);
        const input = {
            TopicArn: this.config.sns.topicArn,
            Message: JSON.stringify(body),
            MessageAttributes: {
                event_type: {
                    DataType: "String",
                    StringValue: eventType,
                },
            },
        };
        await this.client.send(new client_sns_1.PublishCommand(input));
    }
};
exports.SnsPublisher = SnsPublisher;
exports.SnsPublisher = SnsPublisher = __decorate([
    (0, di_1.Injectable)(),
    __param(0, (0, di_1.Inject)(exports.EVENT_BROKER_CONFIG)),
    __metadata("design:paramtypes", [Object])
], SnsPublisher);
