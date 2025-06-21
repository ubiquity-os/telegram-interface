#!/bin/bash
# CI Deployment Script
# Usage: ./deploy.sh [production|preview]

ENVIRONMENT=$1
if [ -z "$ENVIRONMENT" ]; then
  echo "❌ Usage: $0 [production|preview]" >&2
  exit 1
fi

echo "🚀 Starting $ENVIRONMENT deployment..."

# Verify deployctl is available
if ! command -v deployctl &> /dev/null; then
  echo "❌ Error: deployctl not found. Run setup-deno.sh first." >&2
  exit 1
fi

# Verify required variables
if [ -z "$DENO_DEPLOY_TOKEN" ]; then
  echo "❌ Error: DENO_DEPLOY_TOKEN is required" >&2
  exit 1
fi

if [ -z "$DENO_PROJECT_NAME" ] || [ -z "$DENO_PREVIEW_PROJECT_NAME" ]; then
  echo "❌ Error: Project names must be set" >&2
  exit 1
fi

# Set target project
if [ "$ENVIRONMENT" = "production" ]; then
  PROJECT_NAME="$DENO_PROJECT_NAME"
  echo "🏭 Deploying to production project: $PROJECT_NAME"
else
  PROJECT_NAME="$DENO_PREVIEW_PROJECT_NAME"
  echo "🛠️ Deploying to preview project: $PROJECT_NAME"
  CREATE_FLAG="--create"
fi

# Run deployment from project root
cd ..
deployctl deploy \
  --project="$PROJECT_NAME" \
  $CREATE_FLAG \
  --entrypoint=src/main.ts \
  --token="$DENO_DEPLOY_TOKEN" \
  --root="." \
  --include="**" \
  --exclude="**.spec.ts"
cd -

DEPLOY_STATUS=$?

if [ $DEPLOY_STATUS -ne 0 ]; then
  echo "❌ Deployment failed with status $DEPLOY_STATUS" >&2
  exit $DEPLOY_STATUS
fi

echo "✅ $ENVIRONMENT deployment completed successfully"
exit 0
