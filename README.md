# @aisound/event-broker

Reusable TypeScript npm package for publishing events to AWS SNS, polling AWS SQS, and re-emitting events internally via `@tsed/event-emitter`. Usable in both publisher and consumer mode across multiple Ts.ED services.

## Features

- **Publish** events to SNS with `eventType` and payload
- **Poll** SQS (long polling), parse messages, re-emit via `@tsed/event-emitter`
- **Decorator** `@OnSubscribe(eventName)` to subscribe to re-emitted events
- **Ts.ED** configuration via `eventBroker` in your `@Configuration`

## Installation

```bash
npm install @aisound/event-broker @tsed/core @tsed/di @tsed/event-emitter @aws-sdk/client-sns @aws-sdk/client-sqs
```

## Configuration

Use **`EventBrokerModule.forRoot(config)`** in your Ts.ED `imports`. This stores the config on `globalThis` (so it works with pnpm/linking) and returns the module.

**1. Build your config (e.g. from env):**

```ts
import type { EventBrokerConfig } from "@aisound/event-broker";

const eventBrokerConfig: EventBrokerConfig = {
  region: process.env.EVENT_BROKER_REGION || "us-east-1",
  sns: { topicArn: process.env.EVENT_BROKER_SNS_TOPIC_ARN || "" },
  sqs: {
    queueUrl: process.env.EVENT_BROKER_SQS_QUEUE_URL || "",
    enabled: process.env.EVENT_BROKER_SQS_ENABLED === "true",
    maxMessages: 10,
    pollingWaitTimeSeconds: 20,
  },
};
```

**2. In your Server (or root module), spread `EventBrokerModule.forRoot(config)` into `imports`:**

```ts
import { Configuration } from "@tsed/di";
import { EventBrokerModule } from "@aisound/event-broker";
import type { EventBrokerConfig } from "@aisound/event-broker";

const eventBrokerConfig: EventBrokerConfig = { ... }; // see above

@Configuration({
  imports: [
    ...EventBrokerModule.forRoot(eventBrokerConfig),
    // ... other modules
  ],
})
export class Server {}
```

Do **not** add `EventBrokerModule` twice: use either `...EventBrokerModule.forRoot(config)` (recommended) or a separate `EVENT_BROKER_CONFIG` provider plus `EventBrokerModule` in the same scope.

## Usage

### Publishing events (publisher mode)

Inject `EventBrokerService` and call `publish`:

```ts
import { Injectable } from "@tsed/di";
import { EventBrokerService } from "@aisound/event-broker";

@Injectable()
export class MyService {
  constructor(private eventBroker: EventBrokerService) {}

  async doSomething() {
    await this.eventBroker.publish("user.created", { userId: "123", name: "Alice" });
  }
}
```

### Subscribing to events (consumer mode)

Use the `@OnSubscribe` decorator to handle events re-emitted from SQS:

```ts
import { Injectable } from "@tsed/di";
import { OnSubscribe } from "@aisound/event-broker";

@Injectable()
export class UserEventHandler {
  @OnSubscribe("user.created")
  async handleUserCreated(payload: { userId: string; name: string }) {
    console.log("User created:", payload);
  }
}
```

## Config reference

| Key | Type | Description |
|-----|------|-------------|
| `region` | string | AWS region for SNS/SQS clients |
| `sns.topicArn` | string | SNS topic ARN for publishing |
| `sqs.queueUrl` | string | SQS queue URL for polling |
| `sqs.enabled` | boolean | If `false`, SQS consumer does not poll |
| `sqs.maxMessages` | number | Max messages per ReceiveMessage call (default: 10) |
| `sqs.pollingWaitTimeSeconds` | number | Long poll wait time in seconds (default: 20) |

## Local development (linking from another app)

When using a local path in the consumer's `package.json` (e.g. `"@aisound/event-broker": "file:../event-broker"`):

1. **In event-broker repo:** build so `dist/` is up to date.
   ```bash
   cd event-broker && npm run build
   ```

2. **In consumer repo:** reinstall so the link picks up the new build.
   ```bash
   cd your-server && pnpm install
   ```

3. **Confirm the server uses the new code:** check that `node_modules/@aisound/event-broker/dist/module/EventBrokerModule.js` contains the latest logic (e.g. `forRoot`). If you use `file:../event-broker`, pnpm usually symlinks the folder, so after step 1 the server already sees the new `dist/`; step 2 can still help clear cache.

4. **If it still uses old code:** remove the linked package and reinstall.
   ```bash
   rm -rf node_modules/@aisound node_modules/.pnpm/*event-broker* pnpm-lock.yaml
   pnpm install
   ```

## Local development with Floci

`.local/` provisions a local mirror of the AWS event architecture described in
[`knowledgebase/aws/event-architecture.md`](../knowledgebase/aws/event-architecture.md) and
[`knowledgebase/event-architecture.md`](../knowledgebase/event-architecture.md), using
[Floci](https://floci.io/) (a LocalStack-compatible AWS emulator) so backend services can publish
and consume real SNS/SQS/EventBridge/S3 events against `localhost:4566` instead of AWS. Content
moderation/tagging consumers are **not** stood up by this — only the topics, queues, and rules they
plug into (see [Scope](#scope) below).

### Quick start

```bash
cd event-broker
npm run local:up     # or: bash .local/setup.sh
```

This starts Floci in Docker, then provisions everything (SNS topics, SQS queues + subscriptions,
S3 bucket, EventBridge rules), and prints the exact env vars/values to paste into each backend
service's `.env.local`. Re-running `local:up` is safe — resource creation is idempotent.

```bash
npm run local:down   # or: bash .local/teardown.sh
```

stops Floci and wipes its in-memory state (queues, topics, messages — everything is re-created from
scratch on the next `local:up`).

### Pointing a service at Floci

Every service already reads its SNS/SQS config from env vars (see the per-repo table in
[`knowledgebase/event-architecture.md`](../knowledgebase/event-architecture.md)) — nothing in
`event-broker`'s code needs to change. The AWS SDK v3 clients here are created with only `{ region }`,
so redirecting them to Floci is a matter of env vars alone: add these four to each service's
`.env.local`, alongside whichever `EVENT_BROKER_SQS_QUEUE_*_URL` / `EVENT_BROKER_SNS_TOPIC_ARN` lines
`local:up` printed for that service:

```bash
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=us-east-1
EVENT_BROKER_REGION=us-east-1
```

`AWS_ENDPOINT_URL` is read natively by `@aws-sdk/client-sns`/`@aws-sdk/client-sqs` (v3.535+; this
repo is on 3.700) — no `endpoint` override needs to be added to `SnsPublisher`/`SqsConsumer`.

### What gets created

| AWS concept | Real name (stage) | Local name |
|---|---|---|
| Platform events SNS topic | `aisound-stage-platform-events` | `aisound-local-platform-events` |
| Per-consumer SQS queues | `..._<auth\|data\|music\|networkgraph\|social\|...>_queue` | same suffixes, `aisound-local-platform-events_*` |
| Dead-letter queues | none on the main consumer queues today | `<queue>_dlq` + redrive policy on every consumer queue (the target state) |
| `data2` own topic + queue | `aisound-stage-data2-events` → `..._data_queue` (naming bug, kept) | `aisound-local-data2-events` → `..._data_queue` |
| `music2` own topic + queue | `aisound-stage-music2-events` → `..._music_queue` | `aisound-local-music2-events` → `..._music_queue` |
| Upload bucket | `aisound-auclair-be-local` | `aisound-local-uploads` |
| Upload fan-out rules | `uploads-fanout-rule-{image,mp3,mp4}` (EventBridge, no SNS) | `uploads-fanout-rule-{image,mp3,mp4}-local` |
| Tagging/moderation queues | `stage-aisound-tags-queue`, `content_moderation_fast_queue`, `stage-ai-sound-am-sqs` | `aisound_tags_queue_local`, `content_moderation_fast_queue_local`, `ai_sound_am_sqs_local` |

Subscriptions use the SNS default of **raw message delivery off**, because that is what the live
stage subscription has: consumers receive the SNS-wrapped `Notification` envelope, which
`SqsConsumer` unwraps. No filter policy is set at this point — every queue receives every message
until you run `local:filters` (next section).

### Dead-letter queues and retries

Every event-broker consumer queue is created with a `<queue>_dlq` dead-letter queue and a redrive
policy (`maxReceiveCount=5`, 30-second visibility timeout, 14-day DLQ retention), so ack-on-success,
retry backoff and dead-lettering can all be exercised locally. Floci moves a message to the DLQ
natively once it has been received `maxReceiveCount` times without being deleted, and supports
`ChangeMessageVisibility`, `ApproximateReceiveCount` and DLQ redrive.

```bash
# reach the DLQ faster while testing retries (safe to re-run against a running stack)
LOCAL_MAX_RECEIVE_COUNT=2 npm run local:up

# helper: AWS CLI against Floci, no local install needed
awsl() { docker run --rm --network local_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli:2.17.62 --endpoint-url=http://floci:4566 "$@"; }
Q=http://floci:4566/000000000000/aisound-local-platform-events_social_queue

# peek at a DLQ without consuming (visibility 0 leaves the message in place)
awsl sqs receive-message --queue-url ${Q}_dlq --visibility-timeout 0 \
  --message-system-attribute-names ApproximateReceiveCount

# send everything in a DLQ back to its source queue
awsl sqs start-message-move-task \
  --source-arn arn:aws:sqs:us-east-1:000000000000:aisound-local-platform-events_social_queue_dlq
```

Floci does **not** enforce IAM. A new AWS call (for example `sqs:ChangeMessageVisibility`) will work
locally and fail in a deployed environment unless the service's role is granted it — tell DevOps
about any new API action the library starts using.

### Filter policies

```bash
npm run local:filters   # or: bash .local/provision/sync-filters.sh
```

Run this after `local:up` (once, or any time a repo's `.publish(...)`/`@OnSubscribe(...)` calls
change) to scope each subscription down to the events that consumer actually wants — exactly what
`social-fe-devops/script/sync_sns.py` does against real AWS on push to its `events` branch. Rather
than hardcoding the shared registry's 256 events into this repo (which would go stale the moment
anyone adds an event), the script **regenerates it from source**, the same way CI does:

1. Seeds `.local/provision/event_registry.json` from `social-fe-devops/event_registry.json` — the
   real shared registry, so consumers with no repo cloned locally (`data2`, `music2`,
   `personalisation`, `personalisationsocial`, `subscription` — none of these map to a cloned repo,
   per [`knowledgebase/event-architecture.md`](../knowledgebase/event-architecture.md)) keep their
   last-known-real values instead of losing their filter entirely.
2. For each backend repo cloned alongside `event-broker` (`auclair-be-main`, `social-be`,
   `auclair-be-music1`, `auclair-be-data`, `auclair-be-networkgraph`), runs this repo's own
   `generate-event-registry.js` against that repo's `src/` (via a scratch dir with a symlinked
   `src/` — read-only, never writes into the repo itself, which matters because two of the five
   commit their `event_registry.json` instead of gitignoring it) and merges the result in with
   `sync-event-registry.js`, using the same `EVENT_REGISTRY_SERVICE_NAME` short name each repo's
   real `*-cicd.yml` sets (`auth`/`social`/`music`/`data`/`networkgraph` — **not** each repo's
   `package.json` name, since `auclair-be-main` and `social-be` both ship the name
   `"auclair-be-framework"`, a real bug in this monorepo worked around in real CI the same way).
3. Applies the merged registry's per-consumer event lists as each subscription's `FilterPolicy` on
   the local `aisound-local-platform-events` topic (`apply-filters.mjs`), skipping consumers with
   no known events (left unfiltered rather than blocked).

Repo paths are hardcoded relative to this folder (`../auclair-be-main`, etc.) since this whole
`auclair` folder is one monorepo checkout — a repo not present is skipped, not an error.

### Floci UI

[Floci UI](https://github.com/floci-io/floci-ui) is an official AWS-console-style web dashboard for
browsing whatever's provisioned in a Floci instance — topics, queues (with live message counts),
buckets, EventBridge buses, and more. It ships no prebuilt "just run it" image (only the frontend
has one on Docker Hub; the API side has to be built from source), so `.local/ui.sh` clones the real
`floci-ui` repo into `.local/floci-ui/` on first run and builds both halves from it — same
Dockerfiles, same bind-mount layout as their own dev `docker-compose.yml`, just pointed at our
`floci` container instead of theirs.

```bash
npm run local:ui        # or: bash .local/ui.sh   (first run: clones + builds, ~1-2 min)
```

Requires `local:up` to already be running (`floci` must be healthy first). Opens at
**http://localhost:4500**. Stop it with:

```bash
npm run local:ui:down   # or: bash .local/ui-down.sh
```

This leaves `floci` itself running — only the UI containers stop.

**Example — watching a published event show up:**

```bash
# 1. local:up, then publish a test event straight to the platform-events topic
#    (a real service would do this through EventBrokerService.publish(), same effect):
docker run --rm --network local_default \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli:2.17.62 --endpoint-url=http://floci:4566 sns publish \
  --topic-arn arn:aws:sns:us-east-1:000000000000:aisound-local-platform-events \
  --message '{"eventType":"user.login","event_id":"demo-1","payload":{"eventId":"demo-1","userId":"demo-user"}}' \
  --message-attributes '{"eventType":{"DataType":"String","StringValue":"user.login"}}'
```

Then open http://localhost:4500 → **Cloud Explorer** (left sidebar) → service dropdown **SQS**.
Every consumer queue that has `user.login` in its filter policy (per `local:filters` —
`auth`, `music`, `networkgraph`, `personalisationsocial`, `social`) shows **Messages: 1**;
`content_moderation_fast_queue_local` and other unrelated queues stay at 0. Click a queue name to
see its attributes (queue URL, ARN, retention, etc.) in the right-hand panel — this build shows
queue-level detail, not individual message bodies, so `sqs receive-message` via the CLI is still
how you'd inspect a message's actual JSON.

**Console Home** (the landing page) gives a one-glance count per service — after `local:up` you'll
see `SQS: 16`, `EventBridge: 1` (the `default` bus; the three `uploads-fanout-rule-*` rules on it
aren't broken out individually in this build), and **Storage: 1** (`aisound-local-uploads`, click
through to confirm the bucket exists — object browsing wasn't exercised here since nothing's been
uploaded to it yet).

### Scope

Stood up: platform SNS/SQS fan-out, the S3 upload bucket, and the EventBridge upload/moderation
routing (rules + target queues). **Not** stood up: any Lambda, the content-moderation/tagging EC2
workers, or MediaConvert — those are consumers of the queues above, not part of the event plumbing
itself, and are still to be wired up locally later.

## License

MIT
