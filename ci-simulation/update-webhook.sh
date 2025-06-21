#!/bin/bash
# Webhook Update Script
# Usage: ./update-webhook.sh [production|preview]

if [ -z "$1" ]; then
  echo "❌ Error: Environment argument missing" >&2
  exit 1
fi

ENVIRONMENT=$1
echo "🔗 Updating Telegram webhook for $ENVIRONMENT environment..."

# Set environment-specific variables
if [ "$ENVIRONMENT" = "production" ]; then
  BOT_TOKEN="$BOT_TOKEN"
  WEBHOOK_SECRET="$WEBHOOK_SECRET_PRODUCTION"
  PROJECT_NAME="$DENO_PROJECT_NAME"
elif [ "$ENVIRONMENT" = "preview" ]; then
  BOT_TOKEN="$PREVIEW_BOT_TOKEN"
  WEBHOOK_SECRET="$WEBHOOK_SECRET_PREVIEW"
  PROJECT_NAME="$DENO_PREVIEW_PROJECT_NAME"
else
  echo "❌ Error: Invalid environment '$ENVIRONMENT'" >&2
  exit 1
fi

# Verify required variables
if [ -z "$BOT_TOKEN" ] || [ -z "$WEBHOOK_SECRET" ] || [ -z "$PROJECT_NAME" ]; then
  echo "❌ Error: Missing required variables for $ENVIRONMENT" >&2
  exit 1
fi

# Construct deployment URL
DEPLOYMENT_URL="https://$PROJECT_NAME.deno.dev"
echo "🌐 Using deployment URL: $DEPLOYMENT_URL"

# Run webhook update script with all required env vars
BOT_TOKEN=$BOT_TOKEN \
WEBHOOK_SECRET=$WEBHOOK_SECRET \
DEPLOYMENT_URL=$DEPLOYMENT_URL \
deno run --allow-net --allow-env ../scripts/update-webhook.ts

UPDATE_STATUS=$?

if [ $UPDATE_STATUS -ne 0 ]; then
  echo "❌ Webhook update failed with status $UPDATE_STATUS" >&2
  exit $UPDATE_STATUS
fi

echo "✅ Webhook updated successfully for $ENVIRONMENT"
exit 0
