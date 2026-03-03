# @aisound/event-broker

Reusable TypeScript npm package for publishing events to AWS SNS, polling AWS SQS, and re-emitting events internally via `@tsed/event-emitter`. Usable in both publisher and consumer mode across multiple Ts.ED services.

## Features

- **Publish** events to SNS with `event_type` and payload
- **Poll** SQS (long polling), parse messages, re-emit via `@tsed/event-emitter`
- **Decorator** `@OnBrokerEvent(eventName)` to subscribe to re-emitted events
- **Ts.ED** configuration via `eventBroker` in your `@Configuration`

## Installation

```bash
npm install @aisound/event-broker @tsed/core @tsed/di @tsed/event-emitter @aws-sdk/client-sns @aws-sdk/client-sqs
```

## Configuration

In your Ts.ED app configuration:

```ts
import { Configuration } from "@tsed/di";
import { EventBrokerModule } from "@aisound/event-broker";

@Configuration({
  imports: [EventBrokerModule],
  eventBroker: {
    region: "us-east-1",
    sns: {
      topicArn: "arn:aws:sns:us-east-1:123456789012:my-topic",
    },
    sqs: {
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/my-queue",
      enabled: true,
      maxMessages: 10,
      pollingWaitTimeSeconds: 20,
    },
  },
})
export class AppConfig {}
```

## Usage

### Publishing events (publisher mode)

Inject `EventBrokerService` and call `eventBroadcast`:

```ts
import { Injectable } from "@tsed/di";
import { EventBrokerService } from "@aisound/event-broker";

@Injectable()
export class MyService {
  constructor(private eventBroker: EventBrokerService) {}

  async doSomething() {
    await this.eventBroker.eventBroadcast("user.created", { userId: "123", name: "Alice" });
  }
}
```

### Subscribing to events (consumer mode)

Use the `@OnBrokerEvent` decorator to handle events re-emitted from SQS:

```ts
import { Injectable } from "@tsed/di";
import { OnBrokerEvent } from "@aisound/event-broker";

@Injectable()
export class UserEventHandler {
  @OnBrokerEvent("user.created")
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

## License

MIT
