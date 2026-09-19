#!/usr/bin/env bash
set -euo pipefail

# Runs inside the amazon/aws-cli container (docker-compose.yml's "provision" service), on the same
# docker network as floci. Creates a local mirror of the two AWS event paths documented in
# knowledgebase/aws/event-architecture.md and the root knowledgebase/event-architecture.md:
#
#   1. Platform events: one SNS topic fanning out to one SQS queue per consumer service
#      (+ the data2/music2 own-topic variants, bug-compatible naming included). Each consumer queue
#      has a "<name>_dlq" dead-letter queue attached through a redrive policy.
#   2. Upload/moderation fan-out: an S3 bucket with EventBridge notifications, routed by three
#      rules (image/mp3/mp4) straight to SQS — no SNS involved, matching AWS.
#
# Idempotent: create-* calls are safe to re-run (existing resources are returned/left as-is).
# Content moderation and media-transcoding consumers are intentionally NOT stood up here — this
# only provisions the topics/queues/rules so events can flow; see ../../README.md.

ENDPOINT="--endpoint-url=http://floci:4566"
REGION="${FLOCI_DEFAULT_REGION:-us-east-1}"
export AWS_PAGER=""

OUT_FILE="/provision/generated.env"
: > "$OUT_FILE"

log() { echo "[provision] $*" >&2; }

create_topic() {
  aws $ENDPOINT --region "$REGION" sns create-topic --name "$1" \
    --query 'TopicArn' --output text
}

create_queue() {
  aws $ENDPOINT --region "$REGION" sqs create-queue --queue-name "$1" \
    --query 'QueueUrl' --output text
}

queue_arn() {
  aws $ENDPOINT --region "$REGION" sqs get-queue-attributes \
    --queue-url "$1" --attribute-names QueueArn \
    --query 'Attributes.QueueArn' --output text
}

# Every event-broker consumer queue gets a DLQ and a redrive policy, so ack-on-success, retry backoff
# and dead-lettering can be exercised locally. Attributes are applied with set-queue-attributes
# rather than at create time so re-running with different LOCAL_* values stays idempotent.
MAX_RECEIVE_COUNT="${LOCAL_MAX_RECEIVE_COUNT:-5}"
VISIBILITY_TIMEOUT="${LOCAL_VISIBILITY_TIMEOUT:-30}"   # matches the live stage queues
DLQ_RETENTION_SECONDS=1209600                          # 14 days; must exceed the source queue's

create_queue_with_dlq() {
  local dlq_url dlq_arn url
  dlq_url=$(create_queue "${1}_dlq")
  aws $ENDPOINT --region "$REGION" sqs set-queue-attributes --queue-url "$dlq_url" \
    --attributes "MessageRetentionPeriod=$DLQ_RETENTION_SECONDS"
  dlq_arn=$(queue_arn "$dlq_url")
  url=$(create_queue "$1")
  aws $ENDPOINT --region "$REGION" sqs set-queue-attributes --queue-url "$url" --attributes \
    "{\"VisibilityTimeout\":\"$VISIBILITY_TIMEOUT\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$dlq_arn\\\",\\\"maxReceiveCount\\\":\\\"$MAX_RECEIVE_COUNT\\\"}\"}"
  echo "$url"
}

subscribe() {
  # Raw message delivery is left at the SNS default (off): the live stage subscription has it
  # Disabled, so consumers receive the SNS-wrapped Notification envelope. SqsConsumer handles both
  # shapes, but tests should run against what stage actually sends.
  aws $ENDPOINT --region "$REGION" sns subscribe \
    --topic-arn "$1" --protocol sqs --notification-endpoint "$2" \
    --query 'SubscriptionArn' --output text >/dev/null
}

# ---------------------------------------------------------------------------
# 1. Platform events (SNS -> SQS)
# ---------------------------------------------------------------------------
log "Creating platform-events SNS topics..."
TOPIC_PLATFORM=$(create_topic "aisound-local-platform-events")
TOPIC_DATA2=$(create_topic "aisound-local-data2-events")
TOPIC_MUSIC2=$(create_topic "aisound-local-music2-events")

log "Creating platform-events SQS queues (each with a DLQ, maxReceiveCount=$MAX_RECEIVE_COUNT) + subscriptions..."
declare -A PLATFORM_QUEUES=(
  [AUTH]="aisound-local-platform-events_auth_queue"
  [DATA]="aisound-local-platform-events_data_queue"
  [MUSIC]="aisound-local-platform-events_music_queue"
  [NETWORKGRAPH]="aisound-local-platform-events_networkgraph_queue"
  [PERSONALISATION]="aisound-local-platform-events_personalisation_queue"
  [PERSONALISATIONSOCIAL]="aisound-local-platform-events_personalisationsocial_queue"
  [SOCIAL]="aisound-local-platform-events_social_queue"
  [SUBSCRIPTION]="aisound-local-platform-events_subscription_queue"
)

for key in "${!PLATFORM_QUEUES[@]}"; do
  qname="${PLATFORM_QUEUES[$key]}"
  qurl=$(create_queue_with_dlq "$qname")
  qarn=$(queue_arn "$qurl")
  subscribe "$TOPIC_PLATFORM" "$qarn"
  echo "EVENT_BROKER_SQS_QUEUE_${key}_URL=$qurl" >>"$OUT_FILE"
done

log "Creating data2/music2 own-topic queues..."
# auclair-be-data2 reads the plain EVENT_BROKER_SQS_QUEUE_URL var and, on real AWS, that var points
# at a queue literally named "..._data_queue" instead of "..._data2_queue" (a known naming bug in
# ai-sound-service-configs, documented in knowledgebase/event-architecture.md section 4).
# Reproduced here on purpose so local behavior matches deployed behavior.
DATA2_QUEUE_URL=$(create_queue_with_dlq "aisound-local-data2-events_data_queue")
DATA2_QUEUE_ARN=$(queue_arn "$DATA2_QUEUE_URL")
subscribe "$TOPIC_DATA2" "$DATA2_QUEUE_ARN"

MUSIC2_QUEUE_URL=$(create_queue_with_dlq "aisound-local-music2-events_music_queue")
MUSIC2_QUEUE_ARN=$(queue_arn "$MUSIC2_QUEUE_URL")
subscribe "$TOPIC_MUSIC2" "$MUSIC2_QUEUE_ARN"

{
  echo ""
  echo "# --- Platform events (event-broker) ---"
  echo "EVENT_BROKER_REGION=$REGION"
  echo "EVENT_BROKER_SNS_TOPIC_ARN=$TOPIC_PLATFORM"
  echo ""
  echo "# auclair-be-data2 (own topic, bug-compatible queue name)"
  echo "EVENT_BROKER_SNS_TOPIC_ARN_DATA2=$TOPIC_DATA2"
  echo "EVENT_BROKER_SQS_QUEUE_URL=$DATA2_QUEUE_URL"
  echo ""
  echo "# auclair-be-music2 (own topic)"
  echo "EVENT_BROKER_SNS_TOPIC_ARN_MUSIC2=$TOPIC_MUSIC2"
  echo "EVENT_BROKER_SQS_QUEUE_MUSIC_URL=$MUSIC2_QUEUE_URL"
} >>"$OUT_FILE"

# ---------------------------------------------------------------------------
# 2. Upload/moderation fan-out (S3 -> EventBridge -> SQS, no SNS)
# ---------------------------------------------------------------------------
log "Creating S3 upload bucket with EventBridge notifications..."
BUCKET="aisound-local-uploads"
aws $ENDPOINT --region "$REGION" s3api create-bucket --bucket "$BUCKET" >/dev/null 2>&1 || true
aws $ENDPOINT --region "$REGION" s3api put-bucket-notification-configuration \
  --bucket "$BUCKET" \
  --notification-configuration '{"EventBridgeConfiguration":{}}'

log "Creating moderation/tagging SQS queues..."
TAGS_QUEUE_URL=$(create_queue "aisound_tags_queue_local")
FAST_MOD_QUEUE_URL=$(create_queue "content_moderation_fast_queue_local")
AM_QUEUE_URL=$(create_queue "ai_sound_am_sqs_local")
TAGS_QUEUE_ARN=$(queue_arn "$TAGS_QUEUE_URL")
FAST_MOD_QUEUE_ARN=$(queue_arn "$FAST_MOD_QUEUE_URL")
AM_QUEUE_ARN=$(queue_arn "$AM_QUEUE_URL")

put_rule() {
  aws $ENDPOINT --region "$REGION" events put-rule --name "$1" --event-pattern "$2" --state ENABLED >/dev/null
}
put_targets() {
  aws $ENDPOINT --region "$REGION" events put-targets --rule "$1" --targets "$2" >/dev/null
}

log "Creating EventBridge rules (image/mp3/mp4 fan-out, not symmetric -- matches AWS)..."

put_rule "uploads-fanout-rule-image-local" \
  "{\"source\":[\"aws.s3\"],\"detail-type\":[\"Object Created\"],\"detail\":{\"bucket\":{\"name\":[\"$BUCKET\"]},\"object\":{\"key\":[{\"prefix\":\"images/\"}]}}}"
put_targets "uploads-fanout-rule-image-local" \
  "[{\"Id\":\"tags\",\"Arn\":\"$TAGS_QUEUE_ARN\"},{\"Id\":\"fastmod\",\"Arn\":\"$FAST_MOD_QUEUE_ARN\"}]"

# mp3: tagging only, no visual moderation -- matches uploads-fanout-rule-mp3 on real AWS.
put_rule "uploads-fanout-rule-mp3-local" \
  "{\"source\":[\"aws.s3\"],\"detail-type\":[\"Object Created\"],\"detail\":{\"bucket\":{\"name\":[\"$BUCKET\"]},\"object\":{\"key\":[{\"prefix\":\"mp3/\"}]}}}"
put_targets "uploads-fanout-rule-mp3-local" \
  "[{\"Id\":\"tags\",\"Arn\":\"$TAGS_QUEUE_ARN\"}]"

put_rule "uploads-fanout-rule-mp4-local" \
  "{\"source\":[\"aws.s3\"],\"detail-type\":[\"Object Created\"],\"detail\":{\"bucket\":{\"name\":[\"$BUCKET\"]},\"object\":{\"key\":[{\"prefix\":\"mp4/\"}]}}}"
put_targets "uploads-fanout-rule-mp4-local" \
  "[{\"Id\":\"audiblemagic\",\"Arn\":\"$AM_QUEUE_ARN\"},{\"Id\":\"fastmod\",\"Arn\":\"$FAST_MOD_QUEUE_ARN\"}]"

{
  echo ""
  echo "# --- Upload/moderation fan-out (S3 -> EventBridge -> SQS) ---"
  echo "S3_BUCKET_NAME=$BUCKET"
  echo "AISOUND_TAGS_QUEUE_URL=$TAGS_QUEUE_URL"
  echo "CONTENT_MODERATION_FAST_QUEUE_URL=$FAST_MOD_QUEUE_URL"
  echo "AI_SOUND_AM_SQS_URL=$AM_QUEUE_URL"
} >>"$OUT_FILE"

log "Done. Values written to .local/provision/generated.env"
