#!/bin/bash
# Token Verification for CI
# Usage: ./verify-token.sh [production|preview]

ENVIRONMENT=$1
if [ -z "$ENVIRONMENT" ]; then
  echo "❌ Usage: $0 [production|preview]" >&2
  exit 1
fi

echo "🔑 Verifying $ENVIRONMENT environment access..."

# Verify required variables are set
if [ -z "$DENO_DEPLOY_TOKEN" ]; then
  echo "❌ Error: DENO_DEPLOY_TOKEN is required" >&2
  exit 1
fi

if [ -z "$DENO_PROJECT_NAME" ] || [ -z "$DENO_PREVIEW_PROJECT_NAME" ]; then
  echo "❌ Error: Project names must be set" >&2
  exit 1
fi

# Set target project
PROJECT_NAME="$([ "$ENVIRONMENT" = "production" ] && echo "$DENO_PROJECT_NAME" || echo "$DENO_PREVIEW_PROJECT_NAME")"

# Test API access
API_URL="https://dash.deno.com/api/projects/$PROJECT_NAME"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $DENO_DEPLOY_TOKEN" \
  "$API_URL")

# Handle response
if [ "$RESPONSE" -eq 200 ]; then
  echo "✅ Token verification successful (HTTP 200)"
  exit 0
elif [ "$RESPONSE" -eq 401 ]; then
  echo "❌ Error: Token verification failed - unauthorized (HTTP 401)" >&2
  exit 1
elif [ "$RESPONSE" -eq 404 ]; then
  echo "❌ Error: Project not found (HTTP 404)" >&2
  exit 1
else
  echo "❌ Error: Unexpected response (HTTP $RESPONSE)" >&2
  exit 1
fi
