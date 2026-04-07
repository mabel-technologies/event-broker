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
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { Configuration, Injectable } from "@tsed/di";
import { $log } from "@tsed/logger";
function extractEventIdFromPayload(payload) {
    if (typeof payload !== "object" || payload === null) {
        throw new Error("[event-broker] publish: payload must be an object with eventId.");
    }
    const { eventId } = payload;
    if (typeof eventId === "string" && eventId.trim() !== "") {
        return eventId.trim();
    }
    throw new Error("[event-broker] publish: payload.eventId must be a non-empty string.");
}
export const EVENT_BROKER_CONFIG = Symbol("EVENT_BROKER_CONFIG");
/** @deprecated Use EventBrokerModule.forRoot(config) instead. */
export const EVENT_BROKER_CONFIG_OPTIONS = Symbol("EVENT_BROKER_CONFIG_OPTIONS");
let SnsPublisher = class SnsPublisher {
    constructor(config) {
        const brokerConfig = config.get("eventBroker");
        if (!brokerConfig?.region || !brokerConfig?.sns || !brokerConfig?.sqs) {
            throw new Error('[event-broker] Config not set. Add eventBroker to your @Configuration({ eventBroker: { region, sns: { topicArn }, sqs: { ... } } }).');
        }
        this.config = brokerConfig;
        this.client = new SNSClient({ region: brokerConfig.region });
    }
    async publish(eventType, payload) {
        const topicArn = this.config.sns?.topicArn?.trim();
        if (!topicArn) {
            throw new Error('[event-broker] sns.topicArn is missing or empty. Set eventBroker.sns.topicArn in your @Configuration.');
        }
        const eventId = extractEventIdFromPayload(payload);
        const body = {
            eventType,
            event_id: eventId,
            payload,
        };
        $log.info(`[event-broker] Publish | eventName=${eventType} eventId=${eventId}`);
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
        try {
            await this.client.send(new PublishCommand(input));
        }
        catch (err) {
            const error = err;
            $log.warn(`[event-broker] Publish failed | eventName=${eventType} eventId=${eventId} error=${error?.message}`);
            throw err;
        }
    }
};
SnsPublisher = __decorate([
    Injectable(),
    __param(0, Configuration()),
    __metadata("design:paramtypes", [Function])
], SnsPublisher);
export { SnsPublisher };
