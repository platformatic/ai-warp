# @platformatic/ai-client

A TypeScript client for streaming AI responses from Platformatic AI services.

## Features

- 🌐 **AI Warp Communication** - Complete TypeScript client for `@platformatic/ai-warp` service API
- 🎯 **Simple API** - `buildClient` and `ask` are the only functions to handles all AI interactions
- 🚀 **Streaming support** - Real-time streaming support

## Installation

```bash
npm install @platformatic/ai-client
```

## Usage

### Endpoints

The Platformatic AI service provides two endpoints:

- **`/api/v1/stream`** - For streaming responses (Server-Sent Events)
- **`/api/v1/prompt`** - For direct responses (JSON)

### Streaming Response (default)

```typescript
import { buildClient } from "@platformatic/ai-client";
import pino from 'pino';

// Create client instance - it handles both streaming and direct
const client = buildClient({
  url: "http://localhost:3042", // Base URL, paths are handled automatically
  headers: {
    Authorization: "Bearer your-api-key",
  },
  timeout: 30000, // optional timeout in ms (default: 60000)
  logger: pino({ level: 'warn' }), // optional Logger instance
});

try {
  // Make a streaming request to the AI service
  const response = await client.ask({
    prompt: "Hello AI, how are you today?",
    sessionId: "user-123",
    temperature: 0.7,
    models: ["openai:gpt-4"], // String format or [{ provider: "openai", model: "gpt-4" }]
    stream: true // optional, defaults to true
  });

  // Access the stream and headers
  const { stream, headers } = response;
  console.log("Response headers:", headers);

  // Read the streaming response
  let fullResponse = "";

  for await (const message of stream) {
    switch (message.type) {
      case "content":
        // Accumulate content chunks
        fullResponse += message.content;
        console.log("Chunk:", message.content);
        break;
      case "error":
        console.error("Error:", message.error);
        break;
      case "done":
        if (message.response) {
          console.log("Final response:", message.response);
        }
        break;
    }
  }

  console.log("Full response:", fullResponse);
} catch (error) {
  console.error("Request failed:", error);
}
```

### Direct Response

```typescript
import { buildClient } from "@platformatic/ai-client";

const client = buildClient({
  url: "http://localhost:3042", // Base URL, paths are handled automatically
  headers: {
    Authorization: "Bearer your-api-key",
  },
});

try {
  // Make a direct request to the AI service
  const response = await client.ask({
    prompt: "Hello AI, how are you today?",
    sessionId: "user-123",
    temperature: 0.7,
    models: ["openai:gpt-4"], // String format or [{ provider: "openai", model: "gpt-4" }]
    stream: false
  });

  // Access the content and headers
  const { content, headers } = response;
  console.log("Response headers:", headers);
  console.log("Response content:", content);
} catch (error) {
  console.error("Request failed:", error);
}
```

### Error Handling

The client provides multiple ways to handle errors:

```typescript
try {
  const response = await client.ask({
    prompt: "Hello AI",
    sessionId: "user-123"
  });

  // Handle stream errors (connection issues, parsing errors, etc.)
  response.stream.on('error', (err) => {
    console.error('Stream error:', err);
  });

  for await (const message of response.stream) {
    if (message.type === 'error') {
      // Handle AI service errors
      console.error('AI service error:', message.error);
    } else if (message.type === 'content') {
      console.log('Received:', message.content);
    } else if (message.type === 'done') {
      console.log('Final response:', message.response);
    }
  }
} catch (error) {
  // Handle request-level errors (HTTP errors, timeouts, etc.)
  console.error("Request failed:", error);
}
```

## Model Configuration

The client supports two model formats:

### String Format (Recommended)
```typescript
const response = await client.ask({
  prompt: "Hello AI",
  models: ["openai:gpt-4"]
});
```

### Object Format
```typescript
const response = await client.ask({
  prompt: "Hello AI",
  models: [{
    provider: "openai",
    model: "gpt-4"
  }]
});
```

### Multiple Models for Fallback

You can specify multiple models for fallback scenarios using either format:

```typescript
const response = await client.ask({
  prompt: "Hello AI",
  models: [
    "openai:gpt-4",
    "openai:gpt-3.5-turbo", 
    "deepseek:deepseek-chat",
    "gemini:gemini-2.5-flash"
  ]
});

// Or using object format
const response = await client.ask({
  prompt: "Hello AI",
  models: [
    { provider: "openai", model: "gpt-4" },
    { provider: "openai", model: "gpt-3.5-turbo" },
    { provider: "deepseek", model: "deepseek-chat" },
    { provider: "gemini", model: "gemini-2.5-flash" }
  ]
});
```

The AI service will try each model in order until one succeeds. Models must match the ones declared in the `ai-warp` service.

## Session Management

The client supports conversation continuity through session IDs. Here's how it works:

### Creating a New Conversation

When you make your first request without a `sessionId`, the AI service creates a new session:

```typescript
// First request - no sessionId provided
const response = await client.ask({
  prompt: "Hello, I'm planning a trip to Italy",
  stream: false
});

// The sessionId is available in both the response content and headers
console.log("New session:", response.content.sessionId);
console.log("Session from header:", response.headers.get('x-session-id'));
// Both will output: "sess_abc123xyz"
```

### Continuing a Conversation

Use the returned `sessionId` in subsequent requests to maintain conversation context:

```typescript
const sessionId = response.content.sessionId;

// Follow-up request using the same sessionId
const followUp = await client.ask({
  prompt: "What's the weather like there in spring?",
  sessionId: sessionId, // Continue the conversation
  stream: false
});

// The AI will remember the previous context about Italy
```

### Streaming with Sessions

Session management works the same way with streaming responses:

```typescript
const response = await client.ask({
  prompt: "Tell me about Rome",
  stream: true
});

let sessionId;

// The sessionId is also available immediately in the response headers
console.log("Session from header:", response.headers.get('x-session-id'));

for await (const message of response.stream) {
  if (message.type === 'done' && message.response) {
    sessionId = message.response.sessionId;
    console.log("Session ID:", sessionId);
  }
}

// Use the sessionId for the next request
const nextResponse = await client.ask({
  prompt: "What are the best restaurants there?",
  sessionId: sessionId,
  stream: true
});
```

## API Reference

### `buildClient(options)`

Creates a new AI client instance.

#### Options

- `url` (string): The AI service URL
- `headers` (object, optional): HTTP headers to include with requests
- `timeout` (number, optional): Request timeout in milliseconds (default: 60000)
- `logger` (Logger, optional): Logger instance (uses abstract-logging if not provided)
- `promptPath` (string, optional): Custom path for direct requests (default: `/api/v1/prompt`)
- `streamPath` (string, optional): Custom path for streaming requests (default: `/api/v1/stream`)

#### Logger Support

You can configure logging by providing a pino logger instance:

```typescript
import pino from 'pino'

const logger = pino({ level: 'info' })

const client = buildClient({
  url: "http://localhost:3000",
  logger: logger
})
```
If no `logger` is provided, the client will use `abstract-logging` (a no-op logger that is API-compatible with the Logger interface).

#### Returns

An `AIClient` instance.

### `client.ask(options)`

Makes a request to the AI service, returning either a stream or a complete response.

#### Options

- **`prompt`** (string): The prompt to send to the AI
- `sessionId` (string, optional): Session ID for conversation continuity. If not provided, the AI service creates a new session. Use the returned `sessionId` from previous responses to maintain conversation context across multiple requests. Each session maintains its own conversation history and context.
- `context` (string, optional): Additional context for the request
- `temperature` (number, optional): AI temperature parameter
- `models` (array, optional): Array of models in either string format `"provider:model"` or object format `{ provider: string, model: string }`. Models must match the ones defined in the `ai-warp` service.
- `history` (array, optional): Previous conversation history as `AiChatHistory` from `@platformatic/ai-provider`
- `stream` (boolean, optional): Enable streaming (default: true)

#### Returns

- When `stream: true` (default): `Promise<AskResponseStream>` - An object containing the stream and headers
- When `stream: false`: `Promise<AskResponseContent>` - An object containing the content and headers

#### Streaming Response Object

```typescript
{
  stream: Readable,        // Node.js Readable stream of StreamMessage objects
  headers: Headers         // Response headers from the server
}
```

#### Direct Response Object

```typescript
{
  content: AskResponse,    // The complete AI response object
  headers: Headers         // Response headers from the server
}
```

### Response Types

#### `AskResponse` (Direct Response Content)

```typescript
{
  text: string,                    // The AI's response text
  sessionId: string,               // Session ID for conversation continuity
  result: AiResponseResult         // Result status: 'COMPLETE' | 'INCOMPLETE_MAX_TOKENS' | 'INCOMPLETE_UNKNOWN'
}
```

#### `StreamMessage` (Streaming Response Messages)

The stream yields different types of messages:

**Content Message** - Contains partial response text:
```typescript
{
  type: 'content',
  content: string          // Partial response text chunk
}
```

**Error Message** - Contains error information:
```typescript
{
  type: 'error',
  error: Error             // Error object with details
}
```

**Done Message** - Contains final response metadata:
```typescript
{
  type: 'done',
  response?: AskResponse   // Final response object with complete metadata
}
```
