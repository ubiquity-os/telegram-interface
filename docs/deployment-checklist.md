# Telegram Bot Deployment Checklist

## ✅ Pre-Deployment (Completed)

- [x] Git repository initialized
- [x] Sensitive tokens removed from tracked files
- [x] Code pushed to GitHub: https://github.com/ubiquity-os/telegram-interface
- [x] GitHub Actions workflow configured for automatic deployment

## 🚀 Deployment Steps

### 1. Create Deno Deploy Account
- [ ] Go to https://deno.com/deploy
- [ ] Sign in with GitHub account

### 2. Create New Project
- [ ] Click "New Project" in Deno Deploy dashboard
- [ ] Select "Deploy from GitHub"
- [ ] Search for `ubiquity-os/telegram-interface`
- [ ] Keep default settings (main branch, src/main.ts)
- [ ] Click "Link"

### 3. Configure Environment Variables
Add these in Deno Deploy project settings:

- [ ] `BOT_TOKEN` = `7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY`
- [ ] `WEBHOOK_SECRET` = `8a3f5d9e2c7b1a4f6e8d3c9b5a7f2e1d4c8b6a3f9e5d2c7b1a4f6e8d3c9b5a7f`
- [ ] `LOG_LEVEL` = `info`
- [ ] `ENVIRONMENT` = `production`

### 4. Deploy Application
- [ ] Wait for automatic deployment (1-2 minutes)
- [ ] Note your deployment URL: `https://YOUR-PROJECT-NAME.deno.dev`

### 5. Register Webhook
Run this command with your deployment URL:

```bash
cd /Users/nv/repos/ubiquity-os/telegram-interface
deno run --allow-net --allow-env scripts/set-webhook.ts https://YOUR-PROJECT-NAME.deno.dev
```

### 6. Verify Deployment
- [ ] Check health endpoint: `https://YOUR-PROJECT-NAME.deno.dev/health`
- [ ] Send test message to bot on Telegram
- [ ] Check Deno Deploy logs for activity

## 📝 Important Notes

- Replace `YOUR-PROJECT-NAME` with your actual Deno Deploy project name
- The bot token provided: `7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY`
- Webhook secret: `8a3f5d9e2c7b1a4f6e8d3c9b5a7f2e1d4c8b6a3f9e5d2c7b1a4f6e8d3c9b5a7f`
- GitHub repository: https://github.com/ubiquity-os/telegram-interface

## 🔧 Troubleshooting Commands

Check webhook status:
```bash
curl https://api.telegram.org/bot7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY/getWebhookInfo
```

Remove webhook (if needed):
```bash
curl https://api.telegram.org/bot7990292303:AAEUDZyTlmdwCqHedi1tosPvXdNnYI5XMYY/deleteWebhook
```

## 🎉 Success Indicators

- Health check returns `{"status":"ok","timestamp":"..."}`
- Bot responds "ok" to messages in Telegram
- Logs show incoming webhook requests
- No errors in Deno Deploy logs