# Dual Deployment Setup Guide

This guide provides complete setup instructions for the dual deployment system with separate production and preview Telegram bots.

## Prerequisites

- GitHub account with repository access
- Two Telegram bots (production and preview) created via [@BotFather](https://t.me/botfather)
- Deno Deploy account (free at https://deno.com/deploy)
- OpenRouter API key for AI functionality

## Telegram Bot Setup

### Create Two Telegram Bots

You need **two separate bots** for the dual deployment system:

1. **Production Bot**: For live production environment
   - Message [@BotFather](https://t.me/botfather)
   - Send `/newbot` and follow prompts
   - Name it something like "YourProject Bot"
   - Save the bot token as `BOT_TOKEN`

2. **Preview Bot**: For testing feature branches
   - Message [@BotFather](https://t.me/botfather) again
   - Send `/newbot` and follow prompts  
   - Name it something like "YourProject Preview Bot"
   - Save the bot token as `PREVIEW_BOT_TOKEN`

## Deno Deploy Project Setup

### 1. Create Deno Deploy Account
1. Go to https://deno.com/deploy
2. Sign in with your GitHub account
3. You'll be redirected to the Deno Deploy dashboard

### 2. Create New Project
1. Click "New Project" on the Deno Deploy dashboard
2. Select "Deploy from GitHub"
3. Authorize Deno Deploy to access your GitHub repositories
4. Search for and select your repository (e.g., `ubiquity-os/telegram-interface`)
5. Configure project settings:
   - **Production Branch**: `main`
   - **Entry Point**: `src/main.ts` (should be auto-detected)
   - **Project Name**: `telegram-interface` (or your preferred name)
6. Click "Link"

### 3. Get Deno Deploy API Token
1. Go to your Deno Deploy dashboard
2. Click on your profile/account settings
3. Generate a new API token
4. Save this as `DENO_DEPLOY_TOKEN` for GitHub secrets

## GitHub Repository Secrets

Configure these secrets in your GitHub repository settings (Settings → Secrets and variables → Actions):

### Required Secrets Table

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `BOT_TOKEN` | Production Telegram bot token | `1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ` |
| `PREVIEW_BOT_TOKEN` | Preview Telegram bot token | `0987654321:ZYXwvuTSRqpONMlkjIHGfeDCBA` |
| `WEBHOOK_SECRET_PRODUCTION` | Production webhook secret | `prod_webhook_secret_random_string_2024` |
| `WEBHOOK_SECRET_PREVIEW` | Preview webhook secret | `preview_webhook_secret_random_string_2024` |
| `OPENROUTER_API_KEY` | OpenRouter AI service API key | `sk-or-v1-abc123def456ghi789...` |
| `DENO_DEPLOY_TOKEN` | Deno Deploy API access token | `ddp_1234567890abcdef...` |

### Generating Webhook Secrets

Generate random webhook secrets using any of these methods:

```bash
# Option 1: Using openssl
openssl rand -hex 32

# Option 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option 3: Online generator
# Visit https://www.uuidgenerator.net/random-string-generator
```

## Environment Configuration

### Local Development Setup

Create a `.env` file for local development:

```bash
# Copy from example
cp .env.example .env

# Edit .env with your values
BOT_TYPE=production
BOT_TOKEN=your_production_bot_token_here
PREVIEW_BOT_TOKEN=your_preview_bot_token_here
WEBHOOK_SECRET_PRODUCTION=your_production_webhook_secret
WEBHOOK_SECRET_PREVIEW=your_preview_webhook_secret
OPENROUTER_API_KEY=your_openrouter_api_key
DEPLOYMENT_URL=https://your-project-name.deno.dev
DENO_DEPLOY_TOKEN=your_deno_deploy_token
DENO_PROJECT_NAME=telegram-interface
ENVIRONMENT=development
LOG_LEVEL=info
```

### Deno Deploy Environment Variables

Set these in your Deno Deploy project dashboard (Project Settings → Environment Variables):

```bash
# Bot Configuration (set by GitHub Actions automatically)
BOT_TYPE=production  # or preview (managed by CI/CD)
BOT_TOKEN=${BOT_TOKEN}
PREVIEW_BOT_TOKEN=${PREVIEW_BOT_TOKEN}

# Webhook Configuration  
WEBHOOK_SECRET_PRODUCTION=${WEBHOOK_SECRET_PRODUCTION}
WEBHOOK_SECRET_PREVIEW=${WEBHOOK_SECRET_PREVIEW}

# API Keys
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}

# Environment Settings
ENVIRONMENT=production
LOG_LEVEL=info
```

> **Note**: GitHub Actions automatically sets the appropriate `BOT_TYPE` and bot token based on the deployment branch.

## Deployment Process

### Automatic Deployment

The system deploys automatically based on Git branches:

#### Production Deployment
1. **Trigger**: Push to `main` branch
2. **Result**: 
   - Deploys to `https://telegram-interface.deno.dev` 
   - Uses production bot (`BOT_TOKEN`)
   - Sets production webhook automatically

#### Preview Deployment  
1. **Trigger**: Push to any feature branch
2. **Result**:
   - Deploys to `https://telegram-interface-{hash}.deno.dev`
   - Uses preview bot (`PREVIEW_BOT_TOKEN`) 
   - Sets preview webhook automatically

#### Cleanup Process
1. **Trigger**: Close Pull Request
2. **Result**: Removes preview bot webhook (deployment remains but disconnected)

### Manual Deployment Procedures

#### Deploy Production Bot
```bash
# 1. Push to main branch (triggers automatic deployment)
git checkout main
git push origin main

# 2. Verify production webhook (optional)
deno run --allow-net --allow-env scripts/check-webhook.ts --bot-type production
```

#### Deploy Preview Bot
```bash
# 1. Create and push feature branch
git checkout -b feature/my-new-feature
git push origin feature/my-new-feature

# 2. Verify preview webhook (optional)  
deno run --allow-net --allow-env scripts/check-webhook.ts --bot-type preview
```

#### Manual Webhook Setup (if needed)
```bash
# Set production webhook
deno run --allow-net --allow-env scripts/set-webhook.ts --bot-type production

# Update preview webhook to latest deployment
deno run --allow-net --allow-env scripts/update-preview-webhook.ts
```

## Verification Steps

### 1. Check Health Endpoints

**Production**:
```bash
curl https://telegram-interface.deno.dev/health
# Expected: {"status":"ok","timestamp":"..."}
```

**Preview** (replace with actual preview URL):
```bash
curl https://telegram-interface-abc123.deno.dev/health  
# Expected: {"status":"ok","timestamp":"..."}
```

### 2. Verify Webhook Status

```bash
# Check both bots
deno run --allow-net --allow-env scripts/check-webhook.ts

# Check specific bot
deno run --allow-net --allow-env scripts/check-webhook.ts --bot-type production
deno run --allow-net --allow-env scripts/check-webhook.ts --bot-type preview
```

**Expected Output**:
```
✅ Production Bot Webhook Status:
- URL: https://telegram-interface.deno.dev/webhook/your_webhook_secret
- Pending updates: 0
- Last error: None

✅ Preview Bot Webhook Status:  
- URL: https://telegram-interface-abc123.deno.dev/webhook/your_preview_secret
- Pending updates: 0
- Last error: None
```

### 3. Test Bot Functionality

**Production Bot**:
1. Send a message to your production bot on Telegram
2. Verify it responds with AI-generated content
3. Check Deno Deploy logs for activity

**Preview Bot**:
1. Send a message to your preview bot on Telegram  
2. Verify it responds with AI-generated content
3. Check Deno Deploy preview deployment logs

## Troubleshooting

### Common Issues

#### 1. "BOT_TOKEN is required" Error
**Cause**: Missing or incorrect bot token configuration

**Solutions**:
- Verify `BOT_TOKEN` is set in GitHub secrets
- Check `PREVIEW_BOT_TOKEN` is set for preview deployments
- Ensure tokens are valid from [@BotFather](https://t.me/botfather)

```bash
# Test token validity
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

#### 2. "Webhook setup failed" Error
**Cause**: Webhook configuration issues

**Solutions**:
- Check webhook secrets are set correctly
- Verify deployment URL is accessible
- Ensure bot tokens match the webhook secrets

```bash
# Check webhook status
curl https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo
```

#### 3. "Bot not responding" Issue
**Cause**: Multiple possible issues

**Debug Steps**:
1. Check Deno Deploy logs for errors
2. Verify health endpoint responds
3. Test webhook URL accessibility
4. Confirm OpenRouter API key is valid

```bash
# Check deployment logs in Deno Deploy dashboard
# Test health endpoint
curl https://your-deployment.deno.dev/health

# Check webhook  
deno run --allow-net --allow-env scripts/check-webhook.ts --bot-type production
```

#### 4. "Deployment failed" Error
**Cause**: GitHub Actions or Deno Deploy issues

**Solutions**:
- Check GitHub Actions workflow logs
- Verify all required secrets are set
- Ensure Deno Deploy project is properly linked
- Check TypeScript compilation errors

#### 5. Preview Webhook Not Updating
**Cause**: Preview deployment webhook automation failure

**Solutions**:
```bash
# Manually update preview webhook
deno run --allow-net --allow-env scripts/update-preview-webhook.ts

# Check if preview deployment exists
# (Should see preview URL in Deno Deploy dashboard)
```

### Environment-Specific Issues

#### Local Development
```bash
# Test configuration loading
deno run --allow-env test-config.ts

# Run bot locally with polling (for testing)
BOT_TYPE=preview deno task dev
```

#### GitHub Actions Failures
1. Check workflow logs in GitHub Actions tab
2. Verify all secrets are configured
3. Ensure branch permissions are correct
4. Check Deno Deploy integration

#### Deno Deploy Issues
1. Check deployment logs in Deno Deploy dashboard
2. Verify project settings and environment variables
3. Test direct deployment from Deno Deploy interface

## Advanced Configuration

### Custom Deployment URLs
If you need to use custom URLs or deploy to different projects:

```bash
# Set production webhook with custom URL
deno run --allow-net --allow-env scripts/set-webhook.ts --bot-type production https://custom.domain.com

# Update environment variables
DENO_PROJECT_NAME=your-custom-project-name
```

### Multiple Environment Setup
For additional environments (staging, development):

1. Create additional bots via [@BotFather](https://t.me/botfather)
2. Add corresponding secrets to GitHub
3. Modify GitHub Actions workflows for additional branches
4. Update configuration logic in [`src/utils/config.ts`](../src/utils/config.ts)

### Security Best Practices

1. **Rotate Tokens Regularly**: Update bot tokens and webhook secrets periodically
2. **Monitor Access**: Check Deno Deploy access logs regularly  
3. **Limit Permissions**: Use minimal required permissions for API tokens
4. **Secure Secrets**: Never commit secrets to version control
5. **Webhook Validation**: Always use webhook secrets for request validation

## Next Steps

After successful deployment:

1. **Monitor Performance**: Check Deno Deploy dashboards regularly
2. **Set Up Alerts**: Configure notifications for deployment failures
3. **Document Changes**: Update this guide with any custom modifications
4. **Test Workflows**: Regularly test the full deployment pipeline
5. **Backup Configuration**: Document all secrets and configuration for disaster recovery

The dual deployment system is now ready for development and production use!