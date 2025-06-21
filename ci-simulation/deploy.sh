#!/bin/bash
# Deployment Script
# Usage: ./deploy.sh [environment] [deno_deploy_token] [production_project] [preview_project]

# Validate arguments
if [ $# -lt 4 ]; then
  echo "❌ Usage: $0 [production|preview] [deno_deploy_token] [production_project] [preview_project]" >&2
  exit 1
fi

ENVIRONMENT=$1
DENO_DEPLOY_TOKEN=$2
DENO_PROJECT_NAME=$3
DENO_PREVIEW_PROJECT_NAME=$4

echo "🚀 Starting $ENVIRONMENT deployment..."

# Verify deployctl is available
if ! command -v deployctl &> /dev/null; then
  echo "❌ Error: deployctl not found. Run setup-deno.sh first." >&2
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
