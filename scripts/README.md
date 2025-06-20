# Webhook Management Scripts

## Quick Reference

### For Preview Testing

```bash
# Set preview bot to your preview deployment
deno run --allow-net --allow-env --allow-read scripts/manage-webhooks.ts set preview https://telegram-interface-YOUR-PREVIEW-ID.deno.dev

# Or use the shortcut script
./scripts/switch-to-preview.ts https://telegram-interface-YOUR-PREVIEW-ID.deno.dev
```

### Check Status

```bash
# Check which URL each bot is using
deno run --allow-net --allow-env --allow-read scripts/manage-webhooks.ts check preview
deno run --allow-net --allow-env --allow-read scripts/manage-webhooks.ts check production
```

### Bot Configuration

Both bot tokens are configured in your `.env` file:
- **Production Bot**: `BOT_TOKEN=your_production_bot_token`
- **Preview Bot**: `PREVIEW_BOT_TOKEN=your_preview_bot_token`

### Current Configuration

- Production Bot → `https://telegram-interface.deno.dev`
- Preview Bot → `https://telegram-interface-69bz2rgywb7m.deno.dev`

Both bots use the same webhook secret from your `.env` file.
