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
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { Configuration, Injectable } from "@tsed/di";
import { $log } from "@tsed/logger";
import { OnSubscribe } from "../decorators/OnSubscribe.js";
/** Add this event to the registry so the filter policies admit it. */
export const HEARTBEAT_EVENT = "platform.heartbeat";
export const HEARTBEAT_HANDLER_ID = "platform.heartbeat";
export const HEARTBEAT_METRIC_NAMESPACE = "Auclair/Events";
/**
 * One listener every consumer registers after its ack flip. A scheduler publishes
 * `platform.heartbeat` every few minutes; a missing `HeartbeatHandled` metric is the only
 * detector for a deleted subscription, a drifted filter policy or a wedged consumer.
 * Needs cloudwatch:PutMetricData on the pod role.
 */
let HeartbeatListener = class HeartbeatListener {
    constructor(config) {
        const cfg = config.get("eventBroker");
        this.cw = new CloudWatchClient({ region: cfg?.region ?? "us-east-2" });
        this.service = cfg?.serviceName ?? process.env.SERVICE_NAME ?? "unknown";
    }
    async onHeartbeat() {
        await this.cw.send(new PutMetricDataCommand({
            Namespace: HEARTBEAT_METRIC_NAMESPACE,
            MetricData: [{ MetricName: "HeartbeatHandled", Value: 1, Dimensions: [{ Name: "Service", Value: this.service }] }],
        }));
        $log.info({ metric: "event_outcome", outcome: "heartbeat", service: this.service });
    }
};
__decorate([
    OnSubscribe(HEARTBEAT_EVENT, { id: HEARTBEAT_HANDLER_ID, idempotent: false }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HeartbeatListener.prototype, "onHeartbeat", null);
HeartbeatListener = __decorate([
    Injectable(),
    __param(0, Configuration()),
    __metadata("design:paramtypes", [Function])
], HeartbeatListener);
export { HeartbeatListener };
