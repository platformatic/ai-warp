import fastify, { type FastifyRequest } from 'fastify'
import ai from '../src/plugins/ai.ts'
import type { PinoLoggerOptions } from 'fastify/types/logger.js'
import type { ChatHistory } from '../src/lib/provider.ts'
import type { StorageOptions } from '../src/lib/storage/index.ts'
import type { Logger } from 'pino'

interface AppOptions {
  start?: boolean
  logger?: PinoLoggerOptions
}

interface ChatRequestBody {
  prompt: string
  stream?: boolean
  history?: ChatHistory
  sessionId?: string
}

const valkeyStorage: StorageOptions = {
  type: 'valkey',
  valkey: {
    host: 'localhost',
    port: 6379,
    database: 0,
    username: 'default',
    password: 'password'
  }
}

const memoryStorage = {
  type: 'memory'
}

export async function app({ start = false, logger }: AppOptions) {
  const app = fastify({ logger })

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  if (!process.env.AUTH_JWT_SECRET) {
    throw new Error('AUTH_JWT_SECRET is not set')
  }

  await app.register(ai, {
    logger: app.log as Logger,
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        // client: TODO custom client
      }
    },
    storage: valkeyStorage,
    auth: {
      jwt: {
        secret: process.env.AUTH_JWT_SECRET,
        algorithm: 'HS256'
      }
    },
    limits: {
      maxTokens: 500,
      rate: {
        max: 10,
        timeWindow: '1m',
      },
      requestTimeout: 10_000,
      historyExpiration: '1d',
      retry: {
        max: 1,
        interval: 1_000
      }
    },
    restore: {
      rateLimit: '1m',
      retry: '1m',
      timeout: '1m',
      providerCommunicationError: '1m',
      providerExceededError: '10m'
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        limits: {
          maxTokens: 50,
          rate: {
            max: 10,
            timeWindow: '1s'
          }
        },
        restore: {
          rateLimit: '30s',
          retry: '2m',
          timeout: '1m',
          providerCommunicationError: '30s',
          providerExceededError: '5m'
        },        
      }
    ]
  })

  // TODO example with full settings from call
  // app.post('/prompt', async (request, reply) => {
  // const { prompt, context, maxTokens, temperature, sessionId } = request.body

  app.post('/chat', async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply) => {
    const { prompt, stream, history, sessionId } = request.body

    const response = await app.ai.request({
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      request,
      prompt,
      stream,
      history,
      sessionId,
    }, reply)

    return response
  })

  app.get('/history/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    const history = await app.ai.retrieveHistory(request.params.sessionId)
    return history
  })

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000

  if (start) {
    await app.listen({ host: process.env.HOST || '0.0.0.0', port })
  }

  return app
}
