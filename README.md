# Telegram Bot for Deno Deploy

A sophisticated Telegram bot interface built with Grammy, designed for seamless deployment on Deno Deploy with AI-powered responses and multi-environment support.

## Features

- **Universal Webhook Architecture** - Single endpoint handles both production and preview bots
- **Intelligent Bot Detection** - Automatic routing based on Telegram update metadata
- **AI-Powered Responses** - Integration with OpenRouter for intelligent conversations
- **MCP Tool Integration** - Model Context Protocol for extended capabilities
- **Multi-Environment Support** - Production and preview environments with automatic management
- **Conversation History** - Persistent context using Deno KV storage
- **Deduplication System** - Prevents duplicate message processing
- **Comprehensive Monitoring** - Health checks, logging, and debugging endpoints
- **Built with [Grammy](https://grammy.dev/)** - Modern TypeScript framework
- **Serverless-Optimized** - Designed for edge deployment and auto-scaling

## Architecture Overview

The bot uses a **Universal Webhook Architecture** that intelligently routes updates to the correct bot instance based on Telegram update metadata. This eliminates the need for separate webhook endpoints and simplifies deployment management.

### Key Components

- **Universal Webhook Handler** (`src/main.ts`) - Single endpoint that handles all bot updates
- **Bot Detection System** (`src/services/bot-detection.ts`) - Analyzes updates to determine target bot
- **Bot Factory** (`src/bot-factory.ts`) - Creates and caches bot instances
- **Conversation History** (`src/services/conversation-history.ts`) - Persistent context with Deno KV
- **AI Integration** (`src/services/get-ai-response.ts`) - OpenRouter integration with MCP tools

## Project Structure

```
telegram-interface/
├── src/
│   ├── main.ts                 # Universal webhook handler
│   ├── bot-factory.ts          # Bot instance management
│   ├── handlers/               # Message and callback handlers
│   ├── middleware/             # Bot middleware
│   ├── services/               # Core services
│   │   ├── bot-detection.ts    # Bot identification logic
│   │   ├── conversation-history.ts # Persistent context
│   │   ├── deduplication.ts    # Duplicate prevention
│   │   ├── get-ai-response.ts  # AI response generation
│   │   └── mcp-hub.ts         # MCP tool integration
│   └── utils/                  # Utility functions
├── scripts/                    # Management and testing scripts
│   ├── deployment-fix-summary.ts # Comprehensive documentation
│   ├── manage-webhooks.ts      # Webhook management
│   ├── test-bot-detection.ts   # Bot detection testing
│   └── check-both-webhooks.ts  # Status monitoring
├── tests/                      # Test suites
├── docs/                       # Comprehensive documentation
└── deno.json                   # Deno configuration
```

## Setup

1. Clone the repository
2. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. Configure your environment variables:
   ```
   # Required for production
   BOT_TOKEN=<your-production-bot-token>
   WEBHOOK_SECRET=<generate-random-string>
   
   # Optional for preview testing
   PREVIEW_BOT_TOKEN=<your-preview-bot-token>
   
   # AI Integration (optional)
   OPENROUTER_API_KEY=<your-openrouter-key>
   
   # Logging
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

### Universal Webhook Setup

The new architecture uses a single webhook endpoint for both bots:

```bash
# Set both bots to use the universal endpoint
bun scripts/manage-webhooks.ts set production https://your-project.deno.dev
bun scripts/manage-webhooks.ts set preview https://your-preview-project.deno.dev

# Check webhook status for both bots
bun scripts/check-both-webhooks.ts

# Test bot detection system
bun scripts/test-bot-detection.ts
```

### Preview Testing

Simplified preview testing workflow:

1. Deploy to preview environment
2. Set preview bot webhook: `bun scripts/switch-to-preview.ts https://your-preview.deno.dev`
3. Test with preview bot - both bots now use the same universal endpoint
4. No manual webhook switching needed between environments

### Deployment Summary

Get a comprehensive overview of the deployment fix:

```bash
bun scripts/deployment-fix-summary.ts
```

## API Endpoints

- `GET /health` - Health check with bot configuration status
- `POST /webhook/{secret}` - Universal webhook endpoint (handles both bots)
- `GET /conversations` - Debug endpoint for conversation history
- `GET /conversations?chatId={id}` - View specific conversation history

## Security

- Bot token is stored in environment variables
- Webhook uses a secret path for validation
- All communication happens over HTTPS
- Request logging for debugging

## License

MIT
