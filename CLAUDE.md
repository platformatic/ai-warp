# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Platformatic AI Warp is a unified AI gateway that provides a scalable interface to multiple AI providers (OpenAI, DeepSeek, Google Gemini) with automatic fallback, session management, and streaming support.

## Common Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests across all packages
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint all packages
pnpm lint

# Fix linting issues
pnpm lint:fix

# Type checking
pnpm typecheck

# Full check (clean, lint, typecheck, test, build)
pnpm check

# Clean all node_modules
pnpm clean
```

### Package-specific commands (run from package directories):

```bash
# Run single package tests
node --test --experimental-strip-types test/*.test.ts

# Run single package with coverage
c8 node --test --experimental-strip-types test/*.test.ts

# Build single package
tsc -p tsconfig.build.json
```

## Architecture

This is a monorepo with 4 main packages:

### @platformatic/ai-provider
Core AI provider abstraction layer located in `packages/ai-provider/`. Contains:
- `src/lib/ai.ts` - Main Ai class with request handling and fallback logic
- `src/providers/` - Provider implementations (OpenAI, DeepSeek, Gemini)
- `src/lib/storage/` - Session storage backends (memory, Valkey/Redis)
- `src/lib/config.ts` - Configuration management with model limits and restore policies

### @platformatic/fastify-ai
Fastify plugin in `packages/fastify-ai/` that wraps the AI provider for HTTP services. Registers the AI provider as `app.ai` with request/response helpers.

### @platformatic/ai-client
TypeScript client in `packages/ai-client/` for consuming AI services. Provides streaming and non-streaming request methods with proper error handling.

### @platformatic/ai-warp
Complete AI service in `packages/ai-warp/` with CLI tools for creating and starting AI services. Includes templates and generators for new services.

## Key Design Patterns

### Model Configuration
Models can be configured as simple strings (`"openai:gpt-4"`) or detailed objects with provider-specific limits and restore policies. The system tries models in order until one succeeds.

### Session Management
Sessions are managed automatically with configurable storage backends. Session IDs are returned in both response body and `x-session-id` header for continuity across requests.

### Error Handling & Fallback
When a model fails, the system automatically tries the next available model. Failed providers are temporarily disabled based on configurable restore policies.

### Streaming Support
Real-time responses via Server-Sent Events (SSE) with proper event parsing and error handling.

## Node.js Requirements

- Node.js >= 22.16.0 (required for `--experimental-strip-types` flag)
- Uses native Node.js test runner, not external frameworks
- ESM modules (`"type": "module"` in package.json)

## Key Dependencies

- `undici` - HTTP client with connection pooling
- `openai` - OpenAI SDK
- `iovalkey` - Valkey/Redis client for distributed sessions
- `fastify` - Web framework
- `pino` - Structured logging

## Examples

See `examples/node-service-fastify-ai/` for a complete service implementation showing provider configuration, session management, and API endpoints.

## Development Notes

- Tests use Node.js built-in test runner with `--experimental-strip-types`
- TypeScript compilation targets are in `tsconfig.build.json`
- Coverage reports use c8 with configuration in `test/config/c8-local.json`
- Environment variables for API keys are required for provider functionality