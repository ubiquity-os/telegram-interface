# GitHub Actions Setup for Automatic Preview Webhook Updates

This guide explains how to set up automatic webhook updates for your preview bot when pushing to non-main branches.

## Prerequisites

You need to add the following secrets to your GitHub repository:

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Add these repository secrets:
   - `BOT_TOKEN` - Your production bot token
   - `PREVIEW_BOT_TOKEN` - Your preview bot token
   - `WEBHOOK_SECRET` - Your webhook secret
   - `DENO_DEPLOY_TOKEN` (optional but recommended) - Your Deno Deploy API token

## Getting a Deno Deploy Token

To enable automatic preview URL detection:

1. Go to [Deno Deploy Dashboard](https://dash.deno.com)
2. Click on your account → Account Settings
3. Go to "Access Tokens"
4. Create a new token with "Read" permissions
5. Add it as `DENO_DEPLOY_TOKEN` in your GitHub secrets

## Available Workflows

### 1. Automatic Workflow (`update-preview-webhook.yml`)

This workflow runs automatically when you push to any branch except `main`:

- Waits for Deno Deploy to create the preview
- Fetches the preview URL using Deno Deploy API
- Updates the preview bot webhook
- Comments on the PR with the preview URL

**Requirements:**
- `DENO_DEPLOY_TOKEN` must be set in GitHub secrets
- Your Deno Deploy project name must be `telegram-interface` (or update the workflow)

### 2. Manual Workflow (`update-preview-webhook-simple.yml`)

This workflow can be triggered manually from GitHub Actions tab:

1. Go to Actions tab in your repository
2. Select "Update Preview Bot Webhook (Simple)"
3. Click "Run workflow"
4. Enter your preview URL (e.g., `https://telegram-interface-abc123.deno.dev`)
5. Click "Run workflow"

This is useful when:
- You don't have a Deno Deploy token
- The automatic workflow fails
- You want to manually control when webhooks are updated

## Workflow Usage

### Automatic Updates

Once configured, the workflow will:

1. **On push to non-main branch:**
   - Wait for Deno Deploy to create preview
   - Automatically update preview bot webhook
   - Verify the webhook was set correctly

2. **On PR creation/update:**
   - Add a comment with the preview URL
   - Show webhook status

### Manual Updates

If automatic updates fail or you prefer manual control:

1. Get your preview URL from Deno Deploy dashboard
2. Go to GitHub Actions → "Update Preview Bot Webhook (Simple)"
3. Run workflow with the preview URL

## Troubleshooting

### Workflow Fails with "DENO_DEPLOY_TOKEN not set"

Add your Deno Deploy API token to GitHub secrets (see "Getting a Deno Deploy Token" above).

### Workflow Fails with "Could not determine preview URL"

1. The preview deployment might not be ready yet
2. Try the manual workflow instead
3. Check if your project name in Deno Deploy matches the workflow

### Webhook Update Fails

1. Verify all required secrets are set in GitHub
2. Check that your preview deployment is actually running
3. Look at the workflow logs for specific error messages

## Alternative: Local Script

If you prefer not to use GitHub Actions, you can still use the local script:

```bash
./scripts/switch-to-preview.ts https://your-preview-url.deno.dev
```

## Best Practices

1. **Security**: Never commit bot tokens or secrets to your repository
2. **Testing**: Always verify the webhook was set correctly after updates
3. **Monitoring**: Check GitHub Actions logs if webhooks aren't updating
4. **Cleanup**: The preview bot webhook persists until you update it again

## Integration with Development Workflow

1. Create a feature branch
2. Push your changes
3. GitHub Action automatically updates preview bot (or run manually)
4. Test with preview bot on Telegram
5. Merge to main when ready
6. Production bot continues uninterrupted

The preview bot allows you to test changes in a real Telegram environment without affecting your production users!
