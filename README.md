# Telegram Bot for Deno Deploy

A minimal Telegram bot built with Grammy and designed to run on Deno Deploy. The bot responds "ok" to all messages.

## Features

- Webhook-based architecture for serverless deployment
- Built with [Grammy](https://grammy.dev/) framework
- TypeScript with Deno runtime
- Automatic deployment via GitHub Actions
- Health check endpoint
- Request logging middleware
- AI-powered responses via OpenRouter
- MCP (Model Context Protocol) tool integration
- Automatic preview bot webhook updates for testing

## Project Structure

```
telegram-interface/
├── src/
│   ├── main.ts           # Entry point for Deno Deploy
│   ├── bot.ts            # Bot initialization
│   ├── handlers/         # Message handlers
│   │   └── message.ts    # Basic message handler
│   ├── middleware/       # Bot middleware
│   │   └── logger.ts     # Request logging
│   └── utils/            # Utility functions
│       └── config.ts     # Configuration management
├── tests/
│   └── bot.test.ts       # Basic test suite
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Actions deployment
├── deno.json             # Deno configuration
├── .env.example          # Example environment variables
└── .gitignore           # Git ignore rules
```

## Setup

1. Clone the repository
2. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. Add your bot token to `.env`:
   ```
   BOT_TOKEN=<your-bot-token-from-botfather>
   WEBHOOK_SECRET=<generate-random-string>
   LOG_LEVEL=info
   ENVIRONMENT=development
   ```

## Local Development

Run the bot locally with file watching:

```bash
deno task dev
```

Run tests:

```bash
deno task test
```

Format code:

```bash
deno task fmt
```

Lint code:

```bash
deno task lint
```

## Deployment to Deno Deploy

### Prerequisites

1. Create an account at [Deno Deploy](https://deno.com/deploy)
2. Create a new project
3. Link your GitHub repository

### Environment Variables

Set these in your Deno Deploy project dashboard:

- `BOT_TOKEN` - Your Telegram bot token
- `WEBHOOK_SECRET` - A random string for webhook security
- `LOG_LEVEL` - Logging level (debug, info, error)
- `ENVIRONMENT` - Set to "production"

### Automatic Deployment

The project is configured for automatic deployment via GitHub Actions. Simply push to the `main` branch and the bot will be deployed automatically.

### Webhook Setup

Use the provided webhook management scripts:

```bash
# Set webhook for production bot
deno run --allow-net --allow-env scripts/set-webhook.ts https://your-project.deno.dev

# Check webhook status
deno run --allow-net --allow-env --allow-read scripts/manage-webhooks.ts check production
```

### Preview Testing

The project supports automatic preview deployments with a dedicated test bot:

1. Add `PREVIEW_BOT_TOKEN` to your `.env` file
2. Push to a non-main branch
3. Use GitHub Actions or manual scripts to update the preview bot webhook

See [Preview Testing Guide](docs/preview-testing-guide.md) and [GitHub Actions Setup](docs/github-actions-setup.md) for details.

## API Endpoints

- `GET /health` - Health check endpoint
- `POST /webhook/{secret}` - Telegram webhook endpoint

## Security

- Bot token is stored in environment variables
- Webhook uses a secret path for validation
- All communication happens over HTTPS
- Request logging for debugging

## License

MIT
