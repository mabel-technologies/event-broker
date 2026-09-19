#!/usr/bin/env node
// Applies SNS FilterPolicy attributes to the local platform-events subscriptions, replicating
// social-fe-devops/script/sync_sns.py's build_consumer_event_map() + filter-update logic against
// Floci instead of real AWS. Run via sync-filters.sh, not directly (needs generated.env from
// setup.sh and a merged registry from the generate/sync step that precedes this).
//
// Usage: node apply-filters.mjs <path-to-merged-registry.json>

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SNSClient,
  ListSubscriptionsByTopicCommand,
  GetSubscriptionAttributesCommand,
  SetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns";

const __dirname = dirname(fileURLToPath(import.meta.url));

const registryPath = process.argv[2];
if (!registryPath) {
  console.error("Usage: node apply-filters.mjs <registry.json>");
  process.exit(1);
}

function loadGeneratedEnv() {
  const path = join(__dirname, "generated.env");
  const lines = readFileSync(path, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
  }
  return env;
}

const env = loadGeneratedEnv();
const TOPIC_ARN = env.EVENT_BROKER_SNS_TOPIC_ARN;
if (!TOPIC_ARN) {
  console.error(
    "[apply-filters] EVENT_BROKER_SNS_TOPIC_ARN not found in generated.env -- run .local/setup.sh first.",
  );
  process.exit(1);
}

const client = new SNSClient({
  region: "us-east-1",
  endpoint: "http://localhost:4566",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const registry = JSON.parse(readFileSync(registryPath, "utf-8"));

// consumer -> sorted [eventName, ...], same as sync_sns.py's build_consumer_event_map()
const consumerEvents = {};
for (const [eventName, cfg] of Object.entries(registry.events ?? {})) {
  for (const consumer of cfg.consumers ?? []) {
    (consumerEvents[consumer] ??= []).push(eventName);
  }
}
for (const events of Object.values(consumerEvents)) events.sort();

function resolveConsumer(queueArn) {
  const queueName = queueArn.split(":").pop() ?? "";
  if (!queueName.endsWith("_queue")) return null;
  return queueName.replace("aisound-local-platform-events_", "").replace(/_queue$/, "");
}

const { Subscriptions } = await client.send(
  new ListSubscriptionsByTopicCommand({ TopicArn: TOPIC_ARN }),
);

let updated = 0;
let unchanged = 0;
let unfiltered = 0;

for (const sub of Subscriptions ?? []) {
  if (!sub.SubscriptionArn || sub.SubscriptionArn === "PendingConfirmation") continue;
  const consumer = resolveConsumer(sub.Endpoint ?? "");
  if (!consumer) continue;

  const events = consumerEvents[consumer];
  if (!events || events.length === 0) {
    console.log(`[apply-filters] ${consumer}: no consumed events in registry, left unfiltered`);
    unfiltered++;
    continue;
  }

  const newPolicy = { eventType: events };
  const { Attributes } = await client.send(
    new GetSubscriptionAttributesCommand({ SubscriptionArn: sub.SubscriptionArn }),
  );
  const currentPolicy = JSON.parse(Attributes?.FilterPolicy ?? "{}");

  if (JSON.stringify(currentPolicy) === JSON.stringify(newPolicy)) {
    console.log(`[apply-filters] ${consumer}: already up to date (${events.length} events)`);
    unchanged++;
    continue;
  }

  await client.send(
    new SetSubscriptionAttributesCommand({
      SubscriptionArn: sub.SubscriptionArn,
      AttributeName: "FilterPolicy",
      AttributeValue: JSON.stringify(newPolicy),
    }),
  );
  console.log(`[apply-filters] ${consumer}: filter policy updated (${events.length} events)`);
  updated++;
}

console.log(
  `[apply-filters] done -- ${updated} updated, ${unchanged} unchanged, ${unfiltered} left unfiltered (no registry entry)`,
);
