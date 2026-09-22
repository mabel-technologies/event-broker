import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { Configuration, Injectable } from "@tsed/di";
import type { DIConfiguration } from "@tsed/di";
import { $log } from "@tsed/logger";
import { OnSubscribe } from "../decorators/OnSubscribe.js";
import type { EventBrokerConfig } from "../types/EventBrokerConfig.js";

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
@Injectable()
export class HeartbeatListener {
  private readonly cw: CloudWatchClient;
  private readonly service: string;

  constructor(@Configuration() config: DIConfiguration) {
    const cfg = config.get("eventBroker") as EventBrokerConfig | undefined;
    this.cw = new CloudWatchClient({ region: cfg?.region ?? "us-east-2" });
    this.service = cfg?.serviceName ?? process.env.SERVICE_NAME ?? "unknown";
  }

  @OnSubscribe(HEARTBEAT_EVENT, { id: HEARTBEAT_HANDLER_ID, idempotent: false })
  async onHeartbeat(): Promise<void> {
    await this.cw.send(
      new PutMetricDataCommand({
        Namespace: HEARTBEAT_METRIC_NAMESPACE,
        MetricData: [{ MetricName: "HeartbeatHandled", Value: 1, Dimensions: [{ Name: "Service", Value: this.service }] }],
      }),
    );
    $log.info({ metric: "event_outcome", outcome: "heartbeat", service: this.service });
  }
}
