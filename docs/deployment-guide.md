# Telegram Bot Deployment Guide for Deno Deploy

This guide will walk you through deploying the Telegram bot to Deno Deploy.

## Prerequisites

- GitHub repository with the code (✓ Complete: https://github.com/ubiquity-os/telegram-interface)
- Deno Deploy account (free at https://deno.com/deploy)
- Bot token and webhook secret ready

## Step 1: Create Deno Deploy Account

1. Go to https://deno.com/deploy
2. Sign in with your GitHub account
3. You'll be redirected to the Deno Deploy dashboard

## Step 2: Create New Project

1. Click "New Project" on the Deno Deploy dashboard
2. Select "Deploy from GitHub"
3. Authorize Deno Deploy to access your GitHub repositories if prompted
4. Search for and select `ubiquity-os/telegram-interface`
5. Keep the default settings:
   - Production Branch: `main`
   - Entry Point: `src/main.ts` (should be auto-detected)
6. Click "Link"

## Step 3: Configure Environment Variables

In your Deno Deploy project dashboard:

1. Go to the "Settings" tab
2. Scroll down to "Environment Variables"
3. Add the following variables:

| Variable | Value |
|----------|-------|
| BOT_TOKEN | 7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY |
| WEBHOOK_SECRET | 8a3f5d9e2c7b1a4f6e8d3c9b5a7f2e1d4c8b6a3f9e5d2c7b1a4f6e8d3c9b5a7f |
| LOG_LEVEL | info |
| ENVIRONMENT | production |

4. Click "Save" after adding all variables

## Step 4: Deploy the Application

1. The deployment should start automatically after linking
2. If not, go to the "Deployments" tab and click "Deploy"
3. Wait for the deployment to complete (usually takes 1-2 minutes)
4. Note your deployment URL (format: `https://your-project-name.deno.dev`)

## Step 5: Register Webhook with Telegram

Once deployed, you need to tell Telegram where to send updates. You have two options:

### Option A: Using the provided script (Recommended)

1. Update the webhook registration script with your deployment URL:

```bash
# In your local project directory
cd /Users/nv/repos/ubiquity-os/telegram-interface

# Edit the script to use your Deno Deploy URL
# Replace 'your-project-name' with your actual project name
deno run --allow-net --allow-env scripts/set-webhook.ts https://your-project-name.deno.dev
```

### Option B: Manual registration using curl

```bash
# Replace YOUR_PROJECT_NAME with your actual Deno Deploy project name
curl -X POST https://api.telegram.org/bot7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY/setWebhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_PROJECT_NAME.deno.dev/webhook/8a3f5d9e2c7b1a4f6e8d3c9b5a7f2e1d4c8b6a3f9e5d2c7b1a4f6e8d3c9b5a7f",
    "drop_pending_updates": true
  }'
```

You should receive a response like:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

## Step 6: Verify Deployment

1. Check the health endpoint:
   ```
   https://your-project-name.deno.dev/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

2. Send a message to your bot on Telegram
3. Check the Deno Deploy logs for incoming requests

## Monitoring and Logs

- View logs in the Deno Deploy dashboard under the "Logs" tab
- Logs are real-time and show all incoming requests and responses
- Use the LOG_LEVEL environment variable to control log verbosity

## Troubleshooting

### Bot not responding
1. Check Deno Deploy logs for errors
2. Verify webhook is registered correctly:
   ```bash
   curl https://api.telegram.org/bot7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY/getWebhookInfo
   ```
3. Ensure environment variables are set correctly

### Webhook errors
- Verify the WEBHOOK_SECRET in environment variables matches the one in your webhook URL
- Check that the deployment URL is correct and accessible

### Deployment fails
- Check the GitHub Actions tab in your repository for build errors
- Ensure all TypeScript files compile without errors
- Verify deno.json configuration is valid

## Automatic Deployments

Your project is configured with GitHub Actions to automatically deploy on push to the main branch. Every commit to main will trigger a new deployment.

## Security Notes

- Never commit sensitive tokens to your repository
- Keep your webhook secret truly secret
- Regularly rotate your bot token if compromised
- Use environment variables for all sensitive data

## Next Steps

- Monitor your bot's performance in the Deno Deploy dashboard
- Set up alerts for deployment failures
- Consider implementing more bot features
- Add error tracking and monitoring services