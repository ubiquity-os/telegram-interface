#!/bin/bash
# CI Simulation Orchestrator
# Usage: ./run-simulation.sh [branch-name]

BRANCH=$1
if [ -z "$BRANCH" ]; then
  echo "❌ Usage: $0 [branch-name]" >&2
  exit 1
fi

# Simulate GitHub Actions environment
if [ "$BRANCH" == "main" ]; then
  ENVIRONMENT="production"
  GITHUB_REF="refs/heads/main"
  GITHUB_EVENT_NAME="push"
else
  ENVIRONMENT="preview"
  GITHUB_REF="refs/heads/$BRANCH"
  GITHUB_EVENT_NAME="push"
fi

echo "🌿 Simulating push to branch: $BRANCH"
echo "🏷️  Setting environment: $ENVIRONMENT"

# Verify all required variables are set
REQUIRED_VARS=(
  DENO_DEPLOY_TOKEN
  DENO_PROJECT_NAME
  DENO_PREVIEW_PROJECT_NAME
  BOT_TOKEN
  PREVIEW_BOT_TOKEN
  WEBHOOK_SECRET_PRODUCTION
  WEBHOOK_SECRET_PREVIEW
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Error: Required variable $var is not set" >&2
    exit 1
  fi
done

# Simulation pipeline
STEPS=(
  "./setup-deno.sh"
  "./verify-token.sh $ENVIRONMENT"
  "./deploy.sh $ENVIRONMENT"
  "./update-webhook.sh $ENVIRONMENT"
)

for step in "${STEPS[@]}"; do
  echo "▶ Executing: $step"
  if ! $step; then
    echo "❌ Simulation failed at: $step" >&2
    exit 1
  fi
done

echo "✅ CI simulation completed successfully for $BRANCH branch"
exit 0
