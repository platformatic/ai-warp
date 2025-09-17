import fastify, { type FastifyRequest } from 'fastify'
import type { PinoLoggerOptions } from 'fastify/types/logger.js'
import { ai, type AiChatHistory, type AiStorageOptions } from '@platformatic/fastify-ai'

interface AppOptions {
  start?: boolean
  logger?: PinoLoggerOptions
}

interface ChatRequestBody {
  prompt: string
  stream?: boolean
  history?: AiChatHistory
  sessionId?: string
  models?: string[]
}

const valkeyStorage: AiStorageOptions = {
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
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not set')
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set')
  }


  await app.register(ai, {
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY },
      deepseek: { apiKey: process.env.DEEPSEEK_API_KEY },
      gemini: { apiKey: process.env.GEMINI_API_KEY }
    },
    storage: valkeyStorage,
    limits: {
      maxTokens: 500,
      rate: {
        max: 10,
        timeWindow: '1m',
      },
      requestTimeout: 60_000,
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
      providerExceededError: '1m'
    },
    models: [
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        limits: { maxTokens: 1500 }
      },

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
      },

      {
        provider: 'gemini',
        model: 'gemini-2.0-flash-001'
      },

      {
        provider: 'deepseek',
        model: 'deepseek-chat',
        restore: {
          providerExceededError: '10s',
          timeout: '10s'
        }
      },

      {
        provider: 'openai',
        model: 'gpt-4o',
      }
    ]
  })

  // TODO example with full settings from call
  // app.post('/prompt', async (request, reply) => {
  // const { prompt, context, maxTokens, temperature, sessionId } = request.body

  app.post('/chat', async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply) => {
    const { prompt, stream, history, sessionId, models } = request.body

    const response = await app.ai.request({
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      request,
      prompt,
      stream,
      history,
      sessionId,
      models: models?.map(model => {
        const [provider, modelName] = model.split(':')
        if (provider !== 'openai' && provider !== 'deepseek' && provider !== 'gemini') {
          throw new Error(`Provider "${provider}" not supported`)
        }
        return { provider, model: modelName }
      })
    }, reply)

    if(request.headers['x-resume'] === 'true' && stream) {
      // send random error on stream
      setTimeout(() => {
        console.log('\n\n\n\n>>> RESUME')
      }, 1000)
    }

    return response
  })

  app.get('/history/:sessionId', async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    // TODO stream or compact
    const history = await app.ai.retrieveHistory(request.params.sessionId)
    return history
  })

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000

  if (start) {
    await app.listen({ host: process.env.HOST || '0.0.0.0', port })
  }

  return app
}
