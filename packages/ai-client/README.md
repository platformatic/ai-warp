# @platformatic/ai-client

A TypeScript client for streaming AI responses from Platformatic AI services. **Browser and Node.js compatible.**

## Features

- 🌐 **Cross-platform** - Works in browsers and Node.js environments
- 🎯 **Simple API** - `buildClient` and `ask` are the only functions to handle all AI interactions
- 🚀 **Streaming support** - Real-time streaming with async iteration
- 🔄 **Type-safe** - Full TypeScript support with type compatibility validation
- 🌊 **Modern streams** - Uses Web Streams API for browser compatibility

## Installation

```bash
npm install @platformatic/ai-client
```

## Usage

### Browser Environment

```javascript
import { buildClient } from "@platformatic/ai-client";

const client = buildClient({
  url: "https://your-ai-service.com",
  headers: {
    Authorization: "Bearer your-api-key",
  },
});

// Streaming request
const response = await client.ask({
  prompt: "List the first 5 prime numbers",
  stream: true,
});

for await (const message of response.stream) {
  if (message.type === "content") {
    console.log(message.content);
  } else if (message.type === "error") {
    console.error("Stream error:", message.error.message);
    break;
  }
}
```

### Node.js Environment

```typescript
import { buildClient } from "@platformatic/ai-client";

const client = buildClient({
  url: process.env.AI_URL || "http://127.0.0.1:3042",
  headers: {
    Authorization: "Bearer your-api-key",
  },
  timeout: 30000
});

// Example usage same as browser
```

## API Endpoints

The Platformatic AI service provides two endpoints:

- **`/api/v1/stream`** - For streaming responses (Server-Sent Events)
- **`/api/v1/prompt`** - For direct responses (JSON)

## Streaming Response (default)

```typescript
import { buildClient } from "@platformatic/ai-client";

const client = buildClient({
  url: process.env.AI_URL || "http://127.0.0.1:3042",
  headers: {
    Authorization: "Bearer your-api-key",
  },
  timeout: 30000,
});

try {
  const response = await client.ask({
    prompt: "List the first 5 prime numbers",
    stream: true,
  });

  console.log(
    "Response headers:",
    Object.fromEntries(response.headers.entries()),
  );

  for await (const message of response.stream) {
    if (message.type === "content") {
      process.stdout.write(message.content);
    } else if (message.type === "done") {
      console.log("\n\n*** Stream completed!");
      console.log("Final response:", message.response);
    } else if (message.type === "error") {
      console.error("\n! Stream error:", message.error.message);
      break;
    }
  }

  console.log("\n*** Stream ended");
} catch (error) {
  console.error("! Error:", error.message);
  process.exit(1);
}
```

## Direct Response

```typescript
import { buildClient } from "@platformatic/ai-client";

const client = buildClient({
  url: process.env.AI_URL || "http://127.0.0.1:3042",
  headers: {
    Authorization: "Bearer your-api-key",
  },
});

try {
  const response = await client.ask({
    prompt: "Please give me the first 10 prime numbers",
    models: ["gemini:gemini-2.5-flash"],
    stream: false,
  });

  console.log("Headers:", Object.fromEntries(response.headers.entries()));
  console.log("Response:", response.content);
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
```

## Error Handling

The client provides multiple ways to handle errors:

```typescript
try {
  const response = await client.ask({
    prompt: "Hello AI",
    sessionId: "user-123",
  });

  for await (const message of response.stream) {
    if (message.type === "error") {
      // Handle AI service errors
      console.error("AI service error:", message.error.message);
      break; // Stop processing on error
    } else if (message.type === "content") {
      console.log("Received:", message.content);
    } else if (message.type === "done") {
      console.log("Final response:", message.response);
    }
  }
} catch (error) {
  // Handle request-level errors (HTTP errors, timeouts, etc.)
  console.error("Request failed:", error.message);
}
```

## Model Configuration

The client supports two model formats:

### String Format (Recommended)

```typescript
const response = await client.ask({
  prompt: "Hello AI",
  models: ["openai:gpt-4"],
});
```

### Object Format

```typescript
const response = await client.ask({
  prompt: "Hello AI",
  models: [
    {
      provider: "openai",
      model: "gpt-4",
    },
  ],
});
```

### Multiple Models for Fallback

You can specify multiple models for fallback scenarios:

```typescript
const response = await client.ask({
  prompt: "Hello AI",
  models: [
    "openai:gpt-4",
    "openai:gpt-3.5-turbo",
    "deepseek:deepseek-chat",
    "gemini:gemini-2.5-flash",
  ],
});

// Or using mixed formats
const response = await client.ask({
  prompt: "Hello AI",
  models: [
    "openai:gpt-4",
    { provider: "deepseek", model: "deepseek-chat" },
    "gemini:gemini-2.5-flash",
  ],
});
```

The AI service will try each model in order until one succeeds. Models must match the ones declared in the `ai-warp` service.

## Session Management

The client supports conversation continuity through session IDs:

### Creating a New Conversation

When you make your first request without a `sessionId`, the AI service creates a new session:

```typescript
// First request - no sessionId provided
const response = await client.ask({
  prompt: "Hello, I'm planning a trip to Italy",
  stream: false,
});

// The sessionId is available in both the response content and headers
console.log("New session:", response.content.sessionId);
console.log("Session from header:", response.headers.get("x-session-id"));
```

### Continuing a Conversation

Use the returned `sessionId` in subsequent requests to maintain conversation context:

```typescript
const sessionId = response.content.sessionId;

// Follow-up request using the same sessionId
const followUp = await client.ask({
  prompt: "What's the weather like there in spring?",
  sessionId: sessionId, // Continue the conversation
  stream: false,
});

// The AI will remember the previous context about Italy
```

### Streaming with Sessions

Session management works the same way with streaming responses:

```typescript
const response = await client.ask({
  prompt: "Tell me about Rome",
  stream: true,
});

let sessionId;

// The sessionId is also available immediately in the response headers
console.log("Session from header:", response.headers.get("x-session-id"));

for await (const message of response.stream) {
  if (message.type === "done" && message.response) {
    sessionId = message.response.sessionId;
    console.log("Session ID:", sessionId);
  }
}

// Use the sessionId for the next request
const nextResponse = await client.ask({
  prompt: "What are the best restaurants there?",
  sessionId: sessionId,
  stream: true,
});
```

## Examples

The package includes working examples:

```bash
# Run the streaming example
node examples/stream.js

# Run the direct response example
node examples/prompt.js

# Run the session + streaming example (multi-turn conversation)
node examples/session-stream.js

# Set custom AI service URL
AI_URL=https://your-ai-service.com node examples/stream.js
```

## Type Safety

The client is fully typed and compatible with `@platformatic/ai-provider` types. Types are duplicated to keep the client dependency-free while maintaining compatibility:

```typescript
import type {
  AiModel,
  AiProvider,
  AiSessionId,
  AiChatHistory,
  QueryModel,
} from "@platformatic/ai-client";

// Types are compatible with ai-provider
const models: QueryModel[] = [
  "openai:gpt-4",
  { provider: "deepseek", model: "deepseek-chat" },
];
```

## API Reference

### `buildClient(options)`

Creates a new AI client instance.

#### Options

- `url` (string): The AI service URL
- `headers` (object, optional): HTTP headers to include with requests
- `timeout` (number, optional): Request timeout in milliseconds (default: 60000)
- `logger` (Logger, optional): Logger instance (uses console log if not provided)
- `promptPath` (string, optional): Custom path for direct requests (default: `/api/v1/prompt`)
- `streamPath` (string, optional): Custom path for streaming requests (default: `/api/v1/stream`)

#### Returns

An `AIClient` instance.

### `client.ask(options)`

Makes a request to the AI service, returning either a stream or a complete response.

#### Options

- **`prompt`** (string): The prompt to send to the AI
- `sessionId` (string, optional): Session ID for conversation continuity. If not provided, the AI service creates a new session. Use the returned `sessionId` from previous responses to maintain conversation context across multiple requests. Each session maintains its own conversation history and context.
- `context` (string | Record<string, any> | any[], optional): Additional context for the request
- `temperature` (number, optional): AI temperature parameter
- `models` (array, optional): Array of models in either string format `"provider:model"` or object format `{ provider: string, model: string }`. Models must match the ones defined in the `ai-warp` service.
- `history` (array, optional): Previous conversation history. Note that `history` and `sessionId` cannot be provided at the same time.
- `stream` (boolean, optional): Enable streaming (default: true)

#### Returns

- When `stream: true` (default): `Promise<AskResponseStream>` - An object containing the async iterable stream and headers
- When `stream: false`: `Promise<AskResponseContent>` - An object containing the content and headers

#### Streaming Response Object

```typescript
{
  stream: AsyncIterableStream<StreamMessage>,  // Async iterable stream of StreamMessage objects
  headers: Headers                             // Response headers from the server
}
```

#### Direct Response Object

```typescript
{
  content: JSON,           // The complete AI response object
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
  content?: string          // Partial response text chunk
}
```

**Error Message** - Contains error information:

```typescript
{
  type: 'error',
  error?: Error             // Error object with details
}
```

**Done Message** - Contains final response metadata:

```typescript
{
  type: 'done',
  response?: AskResponse   // Final response object with complete metadata
}
```

## Browser Compatibility

The client is designed to work in both browser and Node.js environments:

- **Web Streams API**: Uses `ReadableStream`, `TextDecoderStream`, and `TransformStream`
- **Fetch API**: Uses standard `fetch` for HTTP requests
- **AbortSignal**: Uses `AbortSignal.timeout()` for request timeouts
- **Server-Sent Events**: Compatible with browser SSE parsing
- **No Node.js dependencies**: Pure browser-compatible JavaScript

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Build
npm run build

# Lint
npm run lint

# Fix linting issues
npm run lint:fix

# Full check (lint + typecheck + test + build)
npm run check
```

## License

Apache-2.0
