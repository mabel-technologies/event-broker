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
exports.EventBrokerModule = void 0;
const di_1 = require("@tsed/di");
const event_emitter_1 = require("@tsed/event-emitter");
const SnsPublisher_1 = require("../publisher/SnsPublisher");
const SnsPublisher_2 = require("../publisher/SnsPublisher");
const SqsConsumer_1 = require("../consumer/SqsConsumer");
const EventBrokerService_1 = require("../services/EventBrokerService");
let EventBrokerModule = class EventBrokerModule {
    constructor(sqsConsumer) {
        this.sqsConsumer = sqsConsumer;
    }
    $onInit() {
        this.sqsConsumer.start();
    }
    $onDestroy() {
        this.sqsConsumer.stop();
    }
};
exports.EventBrokerModule = EventBrokerModule;
exports.EventBrokerModule = EventBrokerModule = __decorate([
    (0, di_1.Module)({
        imports: [event_emitter_1.EventEmitterModule],
        providers: [
            {
                provide: SnsPublisher_1.EVENT_BROKER_CONFIG,
                useFactory: (config) => {
                    const eventBroker = config.get("eventBroker");
                    if (!eventBroker) {
                        throw new Error('EventBrokerModule requires "eventBroker" in Ts.ED configuration');
                    }
                    return eventBroker;
                },
                deps: [di_1.DIConfiguration],
            },
            SnsPublisher_2.SnsPublisher,
            SqsConsumer_1.SqsConsumer,
            EventBrokerService_1.EventBrokerService,
        ],
    }),
    __param(0, (0, di_1.Inject)(SqsConsumer_1.SqsConsumer)),
    __metadata("design:paramtypes", [SqsConsumer_1.SqsConsumer])
], EventBrokerModule);
