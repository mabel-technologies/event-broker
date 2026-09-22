import type { DIConfiguration } from "@tsed/di";
/** Add this event to the registry so the filter policies admit it. */
export declare const HEARTBEAT_EVENT = "platform.heartbeat";
export declare const HEARTBEAT_HANDLER_ID = "platform.heartbeat";
export declare const HEARTBEAT_METRIC_NAMESPACE = "Auclair/Events";
/**
 * One listener every consumer registers after its ack flip. A scheduler publishes
 * `platform.heartbeat` every few minutes; a missing `HeartbeatHandled` metric is the only
 * detector for a deleted subscription, a drifted filter policy or a wedged consumer.
 * Needs cloudwatch:PutMetricData on the pod role.
 */
export declare class HeartbeatListener {
    private readonly cw;
    private readonly service;
    constructor(config: DIConfiguration);
    onHeartbeat(): Promise<void>;
}
