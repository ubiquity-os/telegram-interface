# Telegram Bot for Deno Deploy

A Telegram bot built with Grammy and designed to run on Deno Deploy with dual deployment support. The bot uses AI to provide intelligent responses and supports both production and preview environments with separate bot instances.

## Features

- **Dual Deployment System**: Separate production and preview bots with branch-based deployment
- **AI-Powered Responses**: Intelligent conversation using OpenRouter and DeepSeek models
- **Webhook-based Architecture**: Optimized for serverless deployment on Deno Deploy
- **Built with [Grammy](https://grammy.dev/)**: Modern Telegram bot framework
- **TypeScript with Deno Runtime**: Type-safe development with modern JavaScript features
- **Automated CI/CD**: GitHub Actions for deployment and webhook management
- **Health Check Endpoints**: Built-in monitoring and status verification
- **Request Logging Middleware**: Comprehensive logging for debugging and monitoring

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
3. Configure environment variables in `.env`:
   ```bash
   # Bot Configuration
   BOT_TYPE=production
   BOT_TOKEN=<your-production-bot-token>
   PREVIEW_BOT_TOKEN=<your-preview-bot-token>
   
   # Webhook Secrets
   WEBHOOK_SECRET_PRODUCTION=<generate-random-string>
   WEBHOOK_SECRET_PREVIEW=<generate-different-random-string>
   
   # API Keys
   OPENROUTER_API_KEY=<your-openrouter-api-key>
   
   # Deployment Configuration
   DEPLOYMENT_URL=https://your-project-name.deno.dev
   DENO_DEPLOY_TOKEN=<your-deno-deploy-api-token>
   DENO_PROJECT_NAME=telegram-interface
   
   # Environment Settings
   ENVIRONMENT=development
   LOG_LEVEL=info
   ```

For complete setup instructions including GitHub secrets configuration, see the [Deployment Guide](docs/deployment-guide.md).

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

## Deployment

### Dual Deployment System

This project supports a sophisticated dual deployment architecture with separate production and preview environments:

- **Production Deployment**: Triggered by pushes to `main` branch
- **Preview Deployment**: Triggered by pushes to feature branches
- **Automatic Webhook Management**: Webhooks configured automatically for both environments
- **Separate Bot Instances**: Uses different Telegram bots for production and preview

### Quick Deployment Setup

1. Create an account at [Deno Deploy](https://deno.com/deploy)
2. Configure GitHub repository secrets (see [Deployment Guide](docs/deployment-guide.md))
3. Push to `main` for production or feature branch for preview

### Documentation

- **[Dual Deployment Architecture](docs/dual-deployment-architecture.md)** - Complete system overview and technical details
- **[Deployment Guide](docs/deployment-guide.md)** - Step-by-step setup instructions and troubleshooting

### Automatic Deployment

The project uses GitHub Actions for automated deployment:
- **Production**: Push to `main` → Deploy to production → Update production bot webhook
- **Preview**: Push to feature branch → Deploy to preview → Update preview bot webhook
- **Cleanup**: Close PR → Remove preview webhook

### Manual Webhook Management

The system includes automated webhook management, but manual scripts are available:

```bash
# Set production webhook
deno run --allow-net --allow-env scripts/set-webhook.ts --bot-type production

# Update preview webhook to latest deployment
deno run --allow-net --allow-env scripts/update-preview-webhook.ts

# Check webhook status for both bots
deno run --allow-net --allow-env scripts/check-webhook.ts
```

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