# @platformatic/ai-client

The client for Platformatic AI services. **Browser and Node.js compatible.**

## Features

- 🌐 **Cross-platform** - Works in browsers and Node.js environments
- 🎯 **Simple API** - `buildClient` and `ask` are the only functions to handle all AI interactions
- 🚀 **Streaming support** - Real-time streaming with async iteration
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

## Stream Resume Functionality

The client includes intelligent stream resume functionality for fault-tolerant streaming. When a streaming connection is interrupted, you can seamlessly resume from where you left off using automatic event ID tracking.

### How Resume Works

The client automatically tracks event IDs from all streaming responses. When you make a subsequent request with the same `sessionId`, the client can resume from the exact point where the previous stream was interrupted.

**Important**: The ai-provider will respond with the complete remaining response starting from the requested event ID. This means you'll receive all events from that point onwards, including any events you may have already processed before the interruption. The client handles this transparently by tracking the last received event ID automatically.

#### AI-Provider Stream Flow

The ai-provider handles streaming and resume through a sophisticated storage-based system:

1. **Event Storage**: All streaming events (content, end, error) are stored in the configured storage backend (memory or Valkey/Redis) as they are generated by the AI model
2. **Session-Based Storage**: Events are stored with the session ID as the key, maintaining complete conversation history
3. **Event ID Indexing**: Each event receives a unique ID and timestamp for precise resumption points
4. **Resume from Storage**: When a resume request is received with `resumeEventId`, the provider:
   - Retrieves all stored events for that session starting from the specified event ID
   - Streams the stored events back to the client without re-calling the AI model
   - Maintains the original event structure and timing
5. **Storage Efficiency**: Events are stored with configurable expiration times to manage storage usage

This storage-based approach ensures that resume operations are fast, reliable, and don't require re-generating content from the AI provider.

### Automatic Resume (Default Behavior)

By default, streaming requests with a `sessionId` will automatically resume from the last received event:

```typescript
// Start a streaming conversation
const response1 = await client.ask({
  prompt: "Write a long story about space exploration",
  sessionId: "my-session-123",
  stream: true,
});

// Consume part of the stream, then connection is interrupted
for await (const message of response1.stream) {
  if (message.type === "content") {
    console.log(message.content);
    // Connection interrupted here...
    break;
  }
}

// Resume the stream automatically - client uses tracked event ID
const response2 = await client.ask({
  prompt: "Continue the story", // This will be ignored for resume
  sessionId: "my-session-123",  // Same session triggers automatic resume
  stream: true,                 // + streaming = auto-resume
  // resume: true               // Default behavior
});

// Continue receiving the remaining content from where it left off
for await (const message of response2.stream) {
  if (message.type === "content") {
    console.log(message.content); // Continues from the last received event
  } else if (message.type === "done") {
    console.log("Story completed!");
  }
}
```

### Manual Resume Control

You can explicitly control resume behavior:

```typescript
// Disable automatic resume for a fresh response
const freshResponse = await client.ask({
  prompt: "Start a new conversation",
  sessionId: existingSessionId,
  stream: true,
  resume: false  // Force new request instead of resume
});

// Enable resume explicitly (same as default)
const resumeResponse = await client.ask({
  prompt: "Continue previous conversation",
  sessionId: existingSessionId,
  stream: true,
  resume: true   // Explicit resume (default behavior)
});

// Manual event ID specification (advanced use case)
const manualResumeResponse = await client.ask({
  prompt: "Resume from specific point",
  sessionId: existingSessionId,
  stream: true,
  resumeEventId: "specific-event-id-123" // Override automatic tracking
});
```

### Automatic Resume Feature

The ai-client includes an intelligent automatic resume system that works seamlessly behind the scenes:

#### How Automatic Resume Works

1. **Event ID Capture**: During streaming, the client automatically extracts and stores event IDs (`id:` field) from each Server-Sent Event
2. **Session Tracking**: Each session's last received event ID is tracked separately in memory
3. **Resume Detection**: When you make a new streaming request with an existing `sessionId`, the client automatically:
   - Checks if there's a tracked event ID for that session
   - Includes the `resumeEventId` parameter in the request to the ai-provider
   - The provider responds with all remaining events from that point onwards
4. **Transparent Operation**: This happens automatically without any configuration or manual intervention

#### Automatic Resume Conditions

Automatic resume is triggered when **all** of the following conditions are met:
- `stream: true` (streaming mode)
- `sessionId` is provided (existing session)
- `resume: true` (default behavior, can be disabled)
- A previous event ID exists for that session

#### Example of Automatic Resume in Action

```javascript
const client = buildClient({ url: 'http://localhost:3042' });

// First request - starts new session
const response1 = await client.ask({
  prompt: 'Write a long story about dragons',
  stream: true
});

let sessionId;
let eventCount = 0;

for await (const message of response1.stream) {
  if (message.type === 'content') {
    console.log(message.content);
    eventCount++;
    
    // Simulate interruption after receiving some events
    if (eventCount === 5) {
      sessionId = response1.headers.get('x-session-id');
      console.log('\n[CONNECTION INTERRUPTED]');
      break; // Stop consuming the stream
    }
  }
}

// Second request - automatic resume (no configuration needed)
const response2 = await client.ask({
  prompt: 'Continue the story', // This prompt will be ignored
  sessionId: sessionId,         // Same session triggers auto-resume
  stream: true                  // + streaming enables resume
});

// Continues exactly where it left off
for await (const message of response2.stream) {
  if (message.type === 'content') {
    console.log(message.content); // Picks up seamlessly
  } else if (message.type === 'done') {
    console.log('\nStory completed via automatic resume!');
  }
}
```

#### Event ID Tracking Details

The client's event ID tracking system:

- **Automatic Capture**: Event IDs are extracted from Server-Sent Events (`id:` field) as they arrive
- **Session-Based Storage**: Each session's last event ID is tracked separately in memory
- **Transparent Operation**: No manual event ID management required
- **Persistent Tracking**: Event IDs persist for the lifetime of the client instance
- **Memory Efficient**: Only the latest event ID per session is stored
- **No Storage Overhead**: Event IDs are kept in memory only, no persistent storage required

### Resume Benefits

- **Fault Tolerance**: Automatically recover from network interruptions, HTTP errors, and stream error events
- **Bandwidth Efficiency**: Only streams remaining content, not previously received data
- **Zero Configuration**: Works automatically with sessionId + streaming
- **Graceful Fallback**: If resume fails, automatically falls back to normal requests
- **Event-Level Precision**: Resumes from the exact event where interruption occurred
- **No API Complexity**: Resume is handled transparently under the hood
- **Multiple Trigger Points**: Resume can be triggered by network issues, HTTP error responses, or `event: error` in streams
- **Automatic Error Recovery**: When `event: error` occurs in streams, the client automatically retries with resume to get the remaining content

### Resume Behavior Notes

- **Automatic Detection**: Resume happens when `sessionId` + `stream: true` + `resume: true` (default)
- **Provider Efficiency**: Resume streams don't trigger new AI provider calls
- **Event-Based**: Resume streams from the last tracked event ID in the session
- **Transparent Operation**: The resume process is completely invisible to your application code
- **Error Handling**: Resume failures gracefully continue with normal provider requests
- **Memory Efficiency**: Only the latest event ID per session is stored, not full conversation history

## Logging

The client supports custom logging through the `logger` option. By default, the client uses a silent logger that produces no output.

### Available Loggers

```typescript
import { buildClient, consoleLogger, nullLogger } from "@platformatic/ai-client";

// Silent logger (default) - no logging output
const client = buildClient({
  url: "http://127.0.0.1:3042",
  logger: nullLogger, // This is the default
});

// Console logger - logs to console
const client = buildClient({
  url: "http://127.0.0.1:3042",
  logger: consoleLogger,
});
```

### Custom Logger

You can provide your own logger implementation:

```typescript
import { buildClient } from "@platformatic/ai-client";

const customLogger = {
  debug: (message: string, data?: any) => {
    // Custom debug logging
    console.debug(`[DEBUG] ${message}`, data);
  },
  info: (message: string, data?: any) => {
    // Custom info logging
    console.info(`[INFO] ${message}`, data);
  },
  warn: (message: string, data?: any) => {
    // Custom warning logging
    console.warn(`[WARN] ${message}`, data);
  },
  error: (message: string, data?: any) => {
    // Custom error logging
    console.error(`[ERROR] ${message}`, data);
  },
};

const client = buildClient({
  url: "http://127.0.0.1:3042",
  logger: customLogger,
});
```

### Logger Interface

```typescript
interface Logger {
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
}
```

The client will log various events including:
- Request details (debug level)
- Successful responses (info level) 
- Request timeouts (warn level)
- Request errors (error level)

## Examples

The package includes working examples:

```bash
# Run the streaming example
node examples/stream.js

# Run the direct response example
node examples/prompt.js

# Run the session + streaming example (multi-turn conversation)
node examples/session-stream.js

# Run the resume functionality demonstration
node examples/resume.js

# Run the automatic error recovery demonstration
node examples/error-recovery.js

# Set custom AI service URL
AI_URL=https://your-ai-service.com node examples/stream.js
```

### Example Descriptions

- **`stream.js`** - Basic streaming functionality with real-time AI responses
- **`prompt.js`** - Direct (non-streaming) requests with complete responses
- **`session-stream.js`** - Session management and conversation continuity with resume capability
- **`resume.js`** - Comprehensive demonstration of stream resume functionality with simulated interruptions
- **`error-recovery.js`** - Automatic error recovery demonstration showing transparent handling of stream errors

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
- `logger` (Logger, optional): Logger instance (default: silent logger - no logging)
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
- `resume` (boolean, optional): Enable automatic stream resume when using `sessionId` + `stream: true` (default: true). When enabled, the client will automatically resume from the last event in the session if available. Set to `false` to force a new request instead of resuming. **Note**: This parameter only applies to streaming requests (`stream: true`).
- `resumeEventId` (string, optional): Specific event ID to resume from. When provided, overrides the automatically tracked event ID for the session. This is an advanced option - normally the client handles event ID tracking automatically.

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
