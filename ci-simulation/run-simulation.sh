#!/bin/bash
# CI Simulation Orchestrator
# Usage: ./run-simulation.sh [branch-name] [deno_deploy_token] [bot_token] [preview_bot_token] [webhook_secret_prod] [webhook_secret_preview] [prod_project] [preview_project]

# Validate arguments
if [ $# -lt 8 ]; then
  echo "❌ Usage: $0 [branch-name] [deno_deploy_token] [bot_token] [preview_bot_token] [webhook_secret_prod] [webhook_secret_preview] [prod_project] [preview_project]" >&2
  exit 1
fi

BRANCH=$1
DENO_DEPLOY_TOKEN=$2
BOT_TOKEN=$3
PREVIEW_BOT_TOKEN=$4
WEBHOOK_SECRET_PRODUCTION=$5
WEBHOOK_SECRET_PREVIEW=$6
DENO_PROJECT_NAME=$7
DENO_PREVIEW_PROJECT_NAME=$8

# Simulate GitHub Actions environment
if [ "$BRANCH" == "main" ]; then
  ENVIRONMENT="production"
  GITHUB_REF="refs/heads/main"
  GITHUB_EVENT_NAME="push"
  CURRENT_BOT_TOKEN="$BOT_TOKEN"
  CURRENT_WEBHOOK_SECRET="$WEBHOOK_SECRET_PRODUCTION"
else
  ENVIRONMENT="preview"
  GITHUB_REF="refs/heads/$BRANCH"
  GITHUB_EVENT_NAME="push"
  CURRENT_BOT_TOKEN="$PREVIEW_BOT_TOKEN"
  CURRENT_WEBHOOK_SECRET="$WEBHOOK_SECRET_PREVIEW"
fi

echo "🌿 Simulating push to branch: $BRANCH"
echo "🏷️  Setting environment: $ENVIRONMENT"

# Simulation pipeline
STEPS=(
  "./setup-deno.sh"
  "./verify-token.sh $ENVIRONMENT $DENO_DEPLOY_TOKEN $DENO_PROJECT_NAME $DENO_PREVIEW_PROJECT_NAME"
  "./deploy.sh $ENVIRONMENT $DENO_DEPLOY_TOKEN $DENO_PROJECT_NAME $DENO_PREVIEW_PROJECT_NAME"
  "./update-webhook.sh $ENVIRONMENT $CURRENT_BOT_TOKEN $CURRENT_WEBHOOK_SECRET $([ "$ENVIRONMENT" = "production" ] && echo "$DENO_PROJECT_NAME" || echo "$DENO_PREVIEW_PROJECT_NAME")"
)

for step in "${STEPS[@]}"; do
  echo "▶ Executing: $step"
  if ! eval "$step"; then
    echo "❌ Simulation failed at: $step" >&2
    exit 1
  fi
done

echo "✅ CI simulation completed successfully for $BRANCH branch"
exit 0
