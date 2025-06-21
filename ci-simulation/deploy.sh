#!/bin/bash
# CI Simulation - Deployment Script
# Usage: ./deploy.sh [production|preview]

ENVIRONMENT=$1
if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: $0 [production|preview]" >&2
  exit 1
fi

echo "🚀 Starting $ENVIRONMENT deployment..."

# Verify deployctl is available
if ! command -v deployctl &> /dev/null; then
  echo "❌ Error: deployctl not found. Run setup-deno.sh first." >&2
  exit 1
fi

# Load environment configuration
if [ ! -f ".env" ]; then
  echo "❌ Error: .env file not found" >&2
  exit 1
fi
source .env

# Verify token is set
if [ -z "$DENO_DEPLOY_TOKEN" ]; then
  echo "❌ Error: DENO_DEPLOY_TOKEN is not set" >&2
  exit 1
fi

# Set project-specific variables
if [ "$ENVIRONMENT" = "production" ]; then
  if [ -z "$DENO_PROJECT_NAME" ]; then
    echo "❌ Error: DENO_PROJECT_NAME is not set" >&2
    exit 1
  fi
  PROJECT_NAME="$DENO_PROJECT_NAME"
  echo "🏭 Deploying to production project: $PROJECT_NAME"
else
  if [ -z "$DENO_PREVIEW_PROJECT_NAME" ]; then
    echo "❌ Error: DENO_PREVIEW_PROJECT_NAME is not set" >&2
    exit 1
  fi
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
