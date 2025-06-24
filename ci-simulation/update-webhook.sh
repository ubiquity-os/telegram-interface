#!/bin/bash
# Webhook Update Script
# Usage: ./update-webhook.sh [environment] [bot_token] [webhook_secret] [project_name]

# Validate arguments
if [ $# -lt 4 ]; then
  echo "❌ Usage: $0 [production|preview] [bot_token] [webhook_secret] [project_name]" >&2
  exit 1
fi

ENVIRONMENT=$1
BOT_TOKEN=$2
WEBHOOK_SECRET=$3
PROJECT_NAME=$4

echo "🔗 Updating Telegram webhook for $ENVIRONMENT environment..."

# Construct deployment URL
DEPLOYMENT_URL="https://$PROJECT_NAME.deno.dev"
echo "🌐 Using deployment URL: $DEPLOYMENT_URL"

# Run webhook update script with arguments
deno run \
  --allow-net \
  --allow-env \
  --allow-read \
  ../scripts/update-webhook.ts \
    --bot-token "$BOT_TOKEN" \
    --webhook-secret "$WEBHOOK_SECRET" \
    --deployment-url "$DEPLOYMENT_URL"

UPDATE_STATUS=$?

if [ $UPDATE_STATUS -ne 0 ]; then
  echo "❌ Webhook update failed with status $UPDATE_STATUS" >&2
  exit $UPDATE_STATUS
fi

echo "✅ Webhook updated successfully for $ENVIRONMENT"
exit 0
