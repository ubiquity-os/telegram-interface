# CLI Chat Interface

A simple command-line interface for chatting with the Telegram Interface Bot through the Core API Server.

## Quick Start

1. **Start the API Server:**
   ```bash
   deno task api-server
   ```

2. **In another terminal, start the CLI chat:**
   ```bash
   deno task cli-chat
   ```

## Usage

The CLI will automatically:
- Check if the API server is running
- Create a new chat session
- Start an interactive chat loop

### Commands
- Type any message to chat with the bot
- `/help` - Show available commands
- `/quit` or `/exit` - Exit the chat

### Example Session
```
🤖 Telegram Interface Bot - CLI Chat
=====================================
✅ Session created: sess_1234567890

Type your messages below. Use /quit to exit.

💬 You: Hello!
⏳ Sending...
🤖 Bot: Hello! How can I help you today?

💬 You: /quit
👋 Goodbye!
```

## Configuration

The CLI uses environment variables:
- `API_URL` - API server URL (default: http://localhost:8001)
- `API_KEY` - API authentication key (default: default-api-key)
- `USER_ID` - User identifier (default: auto-generated)

## Architecture

The CLI client connects to the REST API endpoints:
- `POST /api/v1/sessions` - Creates a new chat session
- `POST /api/v1/messages` - Sends messages to the bot
- `GET /api/v1/health` - Checks server health

All communication uses the Unified Message Protocol (UMP) for platform-agnostic messaging.