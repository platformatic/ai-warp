# @platformatic/ai-warp

Ready-to-run AI service that provides a unified gateway to multiple AI providers with automatic fallback, session management, authentication, and streaming support. Built on Platformatic Service for enterprise-grade scalability.

## 🚀 Features

- **Ready to Deploy**: Pre-built AI gateway service ready for production
- **Multi-Provider Gateway**: OpenAI, DeepSeek, and Google Gemini with automatic fallback
- **RESTful API**: Clean REST endpoints for prompt processing and streaming
- **JWT Authentication**: Built-in authentication with configurable JWT support
- **Session Management**: Persistent conversation history with Valkey/Redis support
- **Real-time Streaming**: Server-Sent Events for real-time AI responses
- **Enterprise Ready**: Built on Platformatic Service with full observability
- **Auto-generated OpenAPI**: Swagger documentation automatically generated

## 📦 Installation

### Quick Start with Watt

```bash
mkdir my-ai-service
cd my-ai-service
npx wattpm@latest create
```

Follow the interactive prompts:
```
? Which kind of service do you want to create? @platformatic/ai-warp
? What AI providers would you like to use? OpenAI, Gemini
? What is your OpenAI API key? [hidden]
? What is your Gemini API key? [hidden]
```

### Manual Installation

```bash
npm install @platformatic/ai-warp
```

## 🔧 Configuration

### Basic Configuration (`platformatic.json`)

```json
{
  "$schema": "https://schemas.platformatic.com/@platformatic/ai-warp/2.0.0.json",
  "server": {
    "hostname": "127.0.0.1",
    "port": 3042
  },
  "ai": {
    "providers": {
      "openai": {
        "apiKey": "{PLT_OPENAI_API_KEY}"
      },
      "gemini": {
        "apiKey": "{PLT_GEMINI_API_KEY}"
      }
    },
    "models": [
      {
        "provider": "openai",
        "model": "gpt-4o-mini"
      },
      {
        "provider": "gemini",
        "model": "gemini-2.5-flash"
      }
    ]
  }
}
```

### Environment Variables (`.env`)

```bash
PORT=3042
HOSTNAME=127.0.0.1

# AI Provider API Keys
PLT_OPENAI_API_KEY=sk-your-openai-api-key
PLT_DEEPSEEK_API_KEY=your-deepseek-api-key  
PLT_GEMINI_API_KEY=your-gemini-api-key

# Optional: Valkey/Redis for session storage
PLT_REDIS_HOST=localhost
PLT_REDIS_PORT=6379
PLT_REDIS_PASSWORD=your-redis-password

# Optional: JWT Authentication
PLT_JWT_SECRET=your-jwt-secret-key
```

## ⚙️ Configuration Options

Configuration file settings are grouped as follows:

### server

Configure server settings:

- `hostname` (string, optional): Server hostname (default: '127.0.0.1')
- `port` (number, optional): Server port (default: 3042)

### ai

Configure AI providers, models, and behavior:

- `providers` (object, required): Provider configurations with API keys
  - `openai` (object, optional): OpenAI provider configuration
    - `apiKey` (string, required): OpenAI API key
  - `deepseek` (object, optional): DeepSeek provider configuration
    - `apiKey` (string, required): DeepSeek API key
  - `gemini` (object, optional): Google Gemini provider configuration
    - `apiKey` (string, required): Gemini API key
- `models` (array, required): Model definitions with providers and optional limits
  - `provider` (string, required): Provider name ('openai', 'deepseek', or 'gemini')
  - `model` (string, required): Model name string
  - `limits` (object, optional): Rate limiting and token limits for this model
    - `maxTokens` (number, optional): Maximum tokens per request
    - `rate` (object, optional): Rate limiting configuration
      - `max` (number, required): Maximum requests per time window
      - `timeWindow` (string|number, required): Time window ('1m', '30s', or milliseconds)
  - `restore` (object, optional): Model-specific recovery settings
- `storage` (object, optional): Session storage configuration (default: `{type: 'memory'}`)
  - `type` (string, required): Storage type ('memory' or 'valkey', default: 'memory')
  - `valkey` (object, optional): Valkey/Redis configuration when type is 'valkey'
    - `host` (string, optional): Server host (default: 'localhost')
    - `port` (number, optional): Server port (default: 6379)
    - `username` (string, optional): Username for authentication
    - `password` (string, optional): Password for authentication
    - `database` (number, optional): Database number (default: 0)
- `limits` (object, optional): Global limits applied to all models
  - `maxTokens` (number, optional): Default max tokens per request
  - `rate` (object, optional): Default rate limiting configuration
    - `max` (number, optional): Maximum requests (default: 200)
    - `timeWindow` (string|number, optional): Time window (default: '30s')
  - `requestTimeout` (number, optional): Request timeout in milliseconds (default: 30000)
  - `retry` (object, optional): Retry configuration
    - `max` (number, optional): Max retry attempts (default: 1)
    - `interval` (number, optional): Retry interval in milliseconds (default: 1000)
  - `historyExpiration` (string|number, optional): Session history expiration (default: '1d')
- `restore` (object, optional): Error recovery settings for automatic restoration
  - `rateLimit` (string|number, optional): Rate limit error recovery time (default: '1m')
  - `retry` (string|number, optional): Retry error recovery time (default: '1m')
  - `timeout` (string|number, optional): Timeout error recovery time (default: '1m')
  - `providerCommunicationError` (string|number, optional): Communication error recovery time (default: '1m')
  - `providerExceededError` (string|number, optional): Quota exceeded error recovery time (default: '10m')
- `promptPath` (string, optional): API endpoint path for prompt requests (default: '/api/v1/prompt')
- `streamPath` (string, optional): API endpoint path for streaming requests (default: '/api/v1/stream')
- `headerSessionIdName` (string, optional): Session ID header name (default: 'x-session-id')

### auth

Configure authentication settings:

- `required` (boolean, optional): If true, any unauthenticated requests will be blocked (default: false)
- `jwt` (object, optional): JWT authentication configuration
  - `secret` (string, optional): JWT secret key for signing and verification
  - `jwks` (object|boolean, optional): JSON Web Key Set configuration for production use
    - `providerDiscovery` (boolean, optional): Enable automatic JWKS discovery
    - `issuersWhitelist` (array, optional): List of allowed JWT issuers
    - `max` (number, optional): Maximum number of keys to cache
    - `ttl` (number, optional): Time-to-live for cached keys
    - `timeout` (number, optional): Request timeout for JWKS endpoints
  - `verify` (object, optional): JWT verification options
    - `allowedIss` (string|array, optional): Allowed JWT issuers
    - `allowedAud` (string|array, optional): Allowed JWT audiences
    - `allowedSub` (string|array, optional): Allowed JWT subjects
    - `requiredClaims` (array, optional): Required JWT claims
    - `maxAge` (string|number, optional): Maximum token age
  - `cookie` (object, optional): Cookie-based JWT authentication
    - `cookieName` (string, optional): Name of the JWT cookie
    - `signed` (boolean, optional): Whether cookies should be signed
- `webhook` (object, optional): Webhook authentication configuration
  - `url` (string, required): Webhook verification endpoint URL

## 📚 API Endpoints

### POST `/api/v1/prompt`

Send a prompt for AI processing (non-streaming).

**Request Body:**
```json
{
  "prompt": "Hello, how are you today?",
  "context": "You are a helpful assistant.",
  "temperature": 0.7,
  "sessionId": "optional-session-id",
  "history": [
    {
      "prompt": "Previous question",
      "response": "Previous response"
    }
  ]
}
```

**Response:**
```json
{
  "text": "Hello! I'm doing well, thank you for asking...",
  "result": "COMPLETE",
  "sessionId": "a81bc81b-cafe-4e5d-abff-90865d1e13b1"
}
```

**Response Headers:**
- `x-session-id`: Session identifier for conversation continuity

### POST `/api/v1/stream`

Send a prompt for AI processing with streaming response.

**Request Body:** Same as `/api/v1/prompt`

**Response:** Server-Sent Events stream
```
Content-Type: text/event-stream

data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" there!"}}]}

data: [DONE]
```

**Response Headers:**
- `x-session-id`: Session identifier

## 🔐 Authentication

### Using JWT Tokens

When authentication is enabled, include JWT token in requests:

```bash
# In Authorization header
curl -X POST http://localhost:3042/api/v1/prompt \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"prompt": "Hello AI"}'

# In cookie (if cookie auth is configured)
curl -X POST http://localhost:3042/api/v1/prompt \
  -H "Content-Type: application/json" \
  -b "auth-token=YOUR_JWT_TOKEN" \
  -d '{"prompt": "Hello AI"}'
```

### Generating JWT Tokens (Development)

```javascript
import jwt from 'jsonwebtoken'

const token = jwt.sign(
  { 
    sub: 'user-123',
    name: 'John Doe',
    iat: Math.floor(Date.now() / 1000)
  },
  'your-jwt-secret',
  { expiresIn: '1h' }
)

console.log('JWT Token:', token)
```

## 🚀 Usage Examples

### Basic Usage

```bash
# Start the service
npm start

# Make a simple request
curl -X POST http://localhost:3042/api/v1/prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What are the first 5 prime numbers?"}'

# Response:
# {
#   "text": "The first 5 prime numbers are: 2, 3, 5, 7, and 11.",
#   "result": "COMPLETE",
#   "sessionId": "a81bc81b-cafe-4e5d-abff-90865d1e13b1"
# }
```

### Streaming Request

```bash
curl -X POST http://localhost:3042/api/v1/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Tell me a short story about space"}' \
  --no-buffer

# Response (streamed):
# data: {"choices":[{"delta":{"content":"Once"}}]}
# data: {"choices":[{"delta":{"content":" upon"}}]}
# data: {"choices":[{"delta":{"content":" a"}}]}
# ...
# data: [DONE]
```

### Session-based Conversation

```bash
# First request (creates session)
SESSION_ID=$(curl -s -X POST http://localhost:3042/api/v1/prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": "My name is Alice. Remember this."}' | jq -r '.sessionId')

# Second request (uses same session)
curl -X POST http://localhost:3042/api/v1/prompt \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"What is my name?\", \"sessionId\": \"$SESSION_ID\"}"

# Response:
# {
#   "text": "Your name is Alice.",
#   "result": "COMPLETE", 
#   "sessionId": "a81bc81b-cafe-4e5d-abff-90865d1e13b1"
# }
```

### Using with Different Models

The service automatically uses the configured models with fallback, but you can monitor which models are being used via logs.

### Custom Context

```bash
curl -X POST http://localhost:3042/api/v1/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "How do I center a div?",
    "context": "You are a senior web developer. Provide practical, modern solutions."
  }'
```

## 🔧 Development

### Local Development

```bash
# Clone and install
git clone <your-repo>
cd your-ai-warp-service
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Start in development mode
npm run dev

# The service will be available at http://localhost:3042
```

### Docker Deployment

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3042

CMD ["npm", "start"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  ai-warp:
    build: .
    ports:
      - "3042:3042"
    environment:
      - PLT_OPENAI_API_KEY=${OPENAI_API_KEY}
      - PLT_GEMINI_API_KEY=${GEMINI_API_KEY}
      - PLT_REDIS_HOST=redis
      - PLT_JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis

  redis:
    image: valkey/valkey:7
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

## 📊 Monitoring and Observability

### Built-in Metrics

The service provides built-in metrics via Platformatic:

```bash
# Health check
curl http://localhost:3042/_health

# Metrics (Prometheus format)
curl http://localhost:3042/metrics

# OpenAPI documentation
curl http://localhost:3042/documentation
```

### Logging

Configure logging in `platformatic.json`:

```json
{
  "logger": {
    "level": "info",
    "transport": {
      "target": "pino-pretty",
      "options": {
        "colorize": true
      }
    }
  }
}
```

## 📋 Default Values

### API Endpoints
- **Prompt Path**: `/api/v1/prompt`
- **Stream Path**: `/api/v1/stream`
- **Session Header**: `x-session-id`

### Storage
- **Type**: `memory`

### Limits and Timeouts
- **Rate Limit**: 200 requests per 30 seconds
- **Request Timeout**: 30 seconds
- **Max Retries**: 1
- **History Expiration**: 1 day

### Recovery Times
- **Rate Limit Recovery**: 1 minute
- **Communication Error Recovery**: 1 minute
- **Exceeded Quota Recovery**: 10 minutes

### Server
- **Hostname**: `127.0.0.1`
- **Port**: `3042`

## 🔍 Troubleshooting

### Common Issues

#### Authentication Errors
```bash
# Check JWT token validity
curl -H "Authorization: Bearer $TOKEN" http://localhost:3042/api/v1/prompt

# Response: 401 Unauthorized
# Solution: Verify JWT secret and token format
```

#### Model Unavailable
```bash
# All models failing
# Check API keys in environment variables
# Check provider status/quotas
# Review logs: npm run logs
```

#### Session Not Found
```bash
# Session ID doesn't exist
# Sessions expire based on historyExpiration setting
# Use memory storage for development, Valkey for production
```

#### Connection Issues
```bash
# Check Valkey/Redis connection
redis-cli -h localhost -p 6379 ping

# Check service health
curl http://localhost:3042/_health
```

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
