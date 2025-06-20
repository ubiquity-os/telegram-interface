# Preview Testing Guide

This guide explains how to test your Telegram bot on Deno Deploy preview branches using a dedicated preview bot.

## Setup

You now have two bots:
- **Production Bot**: Your main bot that runs on `telegram-interface.deno.dev` (token from `BOT_TOKEN` in .env)
- **Preview Bot**: A test bot for testing preview deployments (token from `PREVIEW_BOT_TOKEN` in .env)

## Quick Start

### 1. Switch to Preview Deployment

When you push to a non-main branch, Deno Deploy creates a preview URL like `telegram-interface-69bz2rgywb7m.deno.dev`. 

To point your preview bot to this deployment:

```bash
# Quick method
deno run --allow-net --allow-env scripts/switch-to-preview.ts https://telegram-interface-69bz2rgywb7m.deno.dev

# Or using the full webhook manager
deno run --allow-net --allow-env scripts/manage-webhooks.ts set preview https://telegram-interface-69bz2rgywb7m.deno.dev
```

### 2. Test Your Preview Bot

Once the webhook is set, you can interact with your preview bot on Telegram to test your changes.

### 3. Check Webhook Status

To verify which deployment each bot is pointing to:

```bash
# Check preview bot
deno run --allow-net --allow-env scripts/manage-webhooks.ts check preview

# Check production bot
deno run --allow-net --allow-env scripts/manage-webhooks.ts check production
```

## Available Scripts

### `scripts/manage-webhooks.ts`

Full webhook management for both bots:

```bash
# Set webhook
deno run --allow-net --allow-env scripts/manage-webhooks.ts set <bot> <url>

# Check webhook status
deno run --allow-net --allow-env scripts/manage-webhooks.ts check <bot>

# Clear webhook (for local polling mode)
deno run --allow-net --allow-env scripts/manage-webhooks.ts clear <bot>
```

Where `<bot>` is either `production` or `preview`.

### `scripts/switch-to-preview.ts`

Quick script specifically for switching the preview bot to a new deployment:

```bash
deno run --allow-net --allow-env scripts/switch-to-preview.ts <preview-url>
```

You can also make it executable:

```bash
chmod +x scripts/switch-to-preview.ts
./scripts/switch-to-preview.ts https://telegram-interface-69bz2rgywb7m.deno.dev
```

## Workflow Example

1. Make changes on a feature branch
2. Push to GitHub (Deno Deploy creates preview)
3. Copy the preview URL from Deno Deploy dashboard
4. Run: `./scripts/switch-to-preview.ts <preview-url>`
5. Test with your preview bot on Telegram
6. Iterate as needed
7. When done, merge to main (production bot continues working uninterrupted)

## Local Development

For local development, you can clear the webhook and use polling mode:

```bash
# Clear webhook on preview bot
deno run --allow-net --allow-env scripts/manage-webhooks.ts clear preview

# Then run your bot locally with polling
# (You'll need to implement polling mode in your bot code)
```

## Important Notes

- Both bots are configured via environment variables in your .env file:
  - `BOT_TOKEN` - Your production bot token
  - `PREVIEW_BOT_TOKEN` - Your preview/test bot token
- The preview bot uses the same `WEBHOOK_SECRET` as production (from your .env file)
- Both bots share the same webhook endpoint path (`/webhook/{secret}`)
- Preview deployments automatically get environment variables from your Deno Deploy project settings
- Your production bot remains unaffected while testing on preview

## Troubleshooting

If webhooks aren't working:

1. Check webhook status: `scripts/manage-webhooks.ts check preview`
2. Look for "Last error" in the output
3. Verify your preview deployment is running: Visit `https://your-preview-url.deno.dev/health`
4. Check Deno Deploy logs for errors
