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

## License

MIT
