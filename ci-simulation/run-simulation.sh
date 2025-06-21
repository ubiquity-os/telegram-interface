#!/bin/bash
# CI Simulation Orchestrator - GitHub Actions Simulation
# Usage: ./run-simulation.sh [branch-name]

BRANCH=$1
if [ -z "$BRANCH" ]; then
  echo "Usage: $0 [branch-name]" >&2
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

# Load CI environment configuration
if [ ! -f ".env" ]; then
  echo "Error: .env file not found. Create one based on .env.example" >&2
  exit 1
fi
source .env

# Verify all required variables are set
REQUIRED_VARS=(
  DENO_DEPLOY_TOKEN
  BOT_TOKEN
  PREVIEW_BOT_TOKEN  
  WEBHOOK_SECRET_PRODUCTION
  WEBHOOK_SECRET_PREVIEW
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: Required variable $var is not set in .env" >&2
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
