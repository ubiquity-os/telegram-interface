/**
 * Human-like processing messages for better user experience
 */

const PROCESSING_MESSAGES = [
  "Working on it! 🤔",
  "Just a moment... ⏳",
  "Let me think about that... 💭",
  "Processing your request... ⚡",
  "Give me a sec... 🔍",
  "On it! 🚀",
  "Thinking... 🧠",
  "One moment please... ⌛",
  "Let me check that for you... 📋",
  "Working on your request... 💫",
  "Just a second... ⏱️",
  "Processing... 🔄",
  "Let me see... 👀",
  "Hang tight! 🎯",
  "Almost there... 🏃",
];

const TOOL_SPECIFIC_MESSAGES = {
  weather: [
    "Checking the weather... ☁️",
    "Looking outside... 🌤️",
    "Fetching weather data... 🌡️",
  ],
  search: [
    "Searching for that... 🔎",
    "Looking it up... 📚",
    "Finding information... 🕵️",
  ],
  followup: [
    "I have a question for you... 🤔",
    "Let me ask you something... 💬",
    "Quick question... ❓",
  ],
};

/**
 * Get a random processing message
 */
export function getRandomProcessingMessage(toolHint?: string): string {
  // Check if we have tool-specific messages
  if (toolHint && TOOL_SPECIFIC_MESSAGES[toolHint as keyof typeof TOOL_SPECIFIC_MESSAGES]) {
    const toolMessages = TOOL_SPECIFIC_MESSAGES[toolHint as keyof typeof TOOL_SPECIFIC_MESSAGES];
    return toolMessages[Math.floor(Math.random() * toolMessages.length)];
  }
  
  // Return a general processing message
  return PROCESSING_MESSAGES[Math.floor(Math.random() * PROCESSING_MESSAGES.length)];
}

/**
 * Get a message for when processing is taking longer than expected
 */
export function getLongProcessingMessage(): string {
  const messages = [
    "This is taking a bit longer than expected... 🕐",
    "Still working on it, thanks for your patience! 🙏",
    "Almost done, just a bit more... ⏰",
    "Hang in there, processing complex request... 🔧",
    "Taking a little extra time to get this right... ✨",
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Get a message for retry attempts
 */
export function getRetryMessage(attempt: number): string {
  const messages = [
    `Let me try that again... (attempt ${attempt}) 🔄`,
    `Hmm, let me rethink this... (attempt ${attempt}) 💭`,
    `One more try... (attempt ${attempt}) 🎯`,
    `Let me approach this differently... (attempt ${attempt}) 🔀`,
  ];
  
  return messages[Math.floor(Math.random() * messages.length)];
}
