# Telegram Inline Keyboard Integration

## Overview
Implemented native Telegram inline keyboard support for the `ask_followup_question` tool. When the LLM asks a followup question with options, the bot now displays clickable buttons instead of numbered text options.

## Implementation Details

### 1. Message Handler Updates (`src/handlers/message.ts`)
- Checks if the AI response is a followup question with options
- Creates an `InlineKeyboard` with buttons for each option
- Each button has a unique callback data: `option_{chatId}_{index}`

### 2. Callback Query Handler (`src/handlers/callback-query.ts`)
- New handler for processing button clicks
- Validates the callback data and chat ID
- Updates the message to show the selected option
- Processes the selection as the user's response

### 3. AI Response Service Updates (`src/services/get-ai-response.ts`)
- Added `getLastToolResult()` function to expose tool results
- Stores followup question data for inline keyboard creation
- Clears stored data after processing

### 4. Bot Configuration (`src/bot.ts`)
- Added callback query handler registration
- Handles `callback_query:data` events

## User Experience

### Before (Text-based):
```
Bot: What type of database would work best for your project?

Options:
1. PostgreSQL (Relational)
2. MongoDB (NoSQL)
3. Deno KV (Key-Value)
4. Neo4j (Graph)

User: 2
```

### After (Inline Keyboard):
```
Bot: What type of database would work best for your project?

[PostgreSQL (Relational)]
[MongoDB (NoSQL)]
[Deno KV (Key-Value)]
[Neo4j (Graph)]

User: *clicks button*
Bot: ✅ You selected: MongoDB (NoSQL)
```

## How It Works

1. LLM uses `ask_followup_question` with options
2. Bot detects options and creates inline keyboard
3. User clicks a button
4. Bot receives callback query
5. Bot updates message to show selection
6. Selection is processed as user's response
7. Conversation continues naturally

## Benefits

- **Better UX**: Native Telegram UI instead of text commands
- **Clearer Options**: Visual buttons are easier to understand
- **Faster Interaction**: One click instead of typing
- **Error Prevention**: No typos or invalid selections
- **Visual Feedback**: Shows selected option immediately

## Example Tool Usage

```xml
<ask_followup_question>
<question>Which programming language would you prefer?</question>
<options>["Python", "JavaScript", "Go", "Rust", "Java"]</options>
</ask_followup_question>
```

This will create 5 clickable buttons below the question, one for each language option.

## Security Considerations

- Callback data includes chat ID to prevent cross-chat button clicks
- Validates that the callback is from the correct chat
- Handles expired or invalid callbacks gracefully
