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

# Function to create project if it doesn't exist
create_project() {
  local project_name=$1
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $DENO_DEPLOY_TOKEN" \
    "https://dash.deno.com/api/projects/$project_name")
    
  if [ "$response" -eq 404 ]; then
    echo "🆕 Creating project: $project_name"
    curl -X POST "https://dash.deno.com/api/projects" \
      -H "Authorization: Bearer $DENO_DEPLOY_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$project_name\"}"
  fi
}

# Function to set secret
set_secret() {
  local project_name=$1
  local secret_name=$2
  local secret_value=$3
  
  echo "🔒 Setting secret: $secret_name"
  curl -X POST "https://dash.deno.com/api/projects/$project_name/secrets" \
    -H "Authorization: Bearer $DENO_DEPLOY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$secret_name\", \"value\":\"$secret_value\"}" > /dev/null
}

# Ensure project exists
create_project "$PROJECT_NAME"

# Set secrets based on environment
if [ "$ENVIRONMENT" = "production" ]; then
  set_secret "$PROJECT_NAME" "BOT_TOKEN" "$BOT_TOKEN"
  set_secret "$PROJECT_NAME" "WEBHOOK_SECRET" "$WEBHOOK_SECRET_PRODUCTION"
  set_secret "$PROJECT_NAME" "OPENROUTER_API_KEY" "$OPENROUTER_API_KEY"
  set_secret "$PROJECT_NAME" "BOT_TYPE" "production"
else
  set_secret "$PROJECT_NAME" "BOT_TOKEN" "$PREVIEW_BOT_TOKEN"
  set_secret "$PROJECT_NAME" "WEBHOOK_SECRET" "$WEBHOOK_SECRET_PREVIEW"
  set_secret "$PROJECT_NAME" "OPENROUTER_API_KEY" "$OPENROUTER_API_KEY"
  set_secret "$PROJECT_NAME" "BOT_TYPE" "preview"
fi

# Run deployment with environment variables
cd ..
deployctl deploy \
  --project="$PROJECT_NAME" \
  $CREATE_FLAG \
  --entrypoint=src/main.ts \
  --token="$DENO_DEPLOY_TOKEN" \
  --root="." \
  --include="**" \
  --exclude="**.spec.ts" \
  --env="$ENV_VARS"
cd -

DEPLOY_STATUS=$?

if [ $DEPLOY_STATUS -ne 0 ]; then
  echo "❌ Deployment failed with status $DEPLOY_STATUS" >&2
  exit $DEPLOY_STATUS
fi

echo "✅ $ENVIRONMENT deployment completed successfully"
exit 0
