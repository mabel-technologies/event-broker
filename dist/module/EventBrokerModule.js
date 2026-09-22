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
var EventBrokerModule_1;
import { Inject, Module } from "@tsed/di";
import { EventEmitterModule } from "@tsed/event-emitter";
import { SnsPublisher } from "../publisher/SnsPublisher.js";
import { SqsConsumer } from "../consumer/SqsConsumer.js";
import { EventBrokerService } from "../services/EventBrokerService.js";
let EventBrokerModule = EventBrokerModule_1 = class EventBrokerModule {
    constructor(sqsConsumer, snsPublisher) {
        this.sqsConsumer = sqsConsumer;
        this.snsPublisher = snsPublisher;
    }
    /**
     * Optional: use when not using Ts.ED Configuration eventBroker key.
     * With Ts.ED Configuration approach, add eventBroker to @Configuration({ eventBroker: {...} }) and use imports: [EventBrokerModule].
     */
    static forRoot(_config) {
        return [EventBrokerModule_1];
    }
    /** Validate the topic and queue before polling: a service that cannot reach them must not report healthy. */
    async $onInit() {
        await this.snsPublisher.assertReady();
        await this.sqsConsumer.assertReady();
        this.sqsConsumer.start();
    }
    /** Returns the promise so Ts.ED waits for the drain. */
    $onDestroy() {
        return this.sqsConsumer.stop();
    }
};
EventBrokerModule = EventBrokerModule_1 = __decorate([
    Module({
        imports: [EventEmitterModule],
        providers: [SnsPublisher, SqsConsumer, EventBrokerService],
    }),
    __param(0, Inject(SqsConsumer)),
    __param(1, Inject(SnsPublisher)),
    __metadata("design:paramtypes", [SqsConsumer,
        SnsPublisher])
], EventBrokerModule);
export { EventBrokerModule };
