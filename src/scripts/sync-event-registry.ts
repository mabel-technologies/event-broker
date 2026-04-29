import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { $log } from "@tsed/logger";

const PROJECT_ROOT = resolve(process.env.EVENT_REGISTRY_ROOT ?? process.cwd());

const SERVICE_NAME_MAP: Record<string, string> = {
  "auclair-be-framework": "auth",
};

type LocalRegistry = {
  service: string;
  producers: string[];
  consumers: string[];
};

type DevopsRegistry = {
  version: string;
  topic: string;
  events: Record<string, { producer: string; consumers: string[] }>;
};

function getDevopsServiceName(localService: string): string {
  if (process.env.EVENT_REGISTRY_SERVICE_NAME) {
    return process.env.EVENT_REGISTRY_SERVICE_NAME;
  }
  return SERVICE_NAME_MAP[localService] ?? localService;
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const registryPathArg = args[0];
  if (!registryPathArg) {
    $log.error(
      "Usage: pnpm run events:registry:sync -- <path-to-devops-registry.json>",
    );
    process.exit(1);
  }

  const devopsPath = resolve(PROJECT_ROOT, registryPathArg);
  const localPath = join(PROJECT_ROOT, "event_registry.json");

  const local: LocalRegistry = JSON.parse(readFileSync(localPath, "utf-8"));
  const devops: DevopsRegistry = JSON.parse(readFileSync(devopsPath, "utf-8"));

  if (!devops.events) devops.events = {};

  const me = getDevopsServiceName(local.service);
  const ourProducers = new Set(local.producers);
  const ourConsumers = new Set(local.consumers);

  for (const eventName of Object.keys(devops.events)) {
    const entry = devops.events[eventName];
    if (!ourConsumers.has(eventName)) {
      entry.consumers = (entry.consumers || []).filter((s) => s !== me);
    }
    if (entry.producer === me && !ourProducers.has(eventName)) {
      entry.producer = "";
    }
  }

  for (const eventName of ourProducers) {
    if (!devops.events[eventName]) {
      devops.events[eventName] = { producer: "", consumers: [] };
    }
    devops.events[eventName].producer = me;
  }

  for (const eventName of ourConsumers) {
    if (!devops.events[eventName]) {
      devops.events[eventName] = { producer: "", consumers: [] };
    }
    const consumers = devops.events[eventName].consumers ?? [];
    if (!consumers.includes(me)) {
      devops.events[eventName].consumers = [...consumers, me].sort();
    }
  }

  writeFileSync(devopsPath, JSON.stringify(devops, null, 2) + "\n", "utf-8");
  $log.info(`Updated ${devopsPath} for service "${me}"`);
}

main();
