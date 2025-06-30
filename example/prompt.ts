import fastify, { type FastifyRequest } from 'fastify'
import ai, { type FastifyAiRouteConfig } from '../src/plugins/ai.ts'
import type { PinoLoggerOptions } from 'fastify/types/logger.js'
import type { ChatHistory } from '../src/lib/provider.ts'
import type { StorageOptions } from '../src/lib/storage/index.ts'

interface AppOptions {
  start?: boolean
  logger?: PinoLoggerOptions
}

interface ChatRequestBody {
  prompt: string
  stream?: boolean
  history?: ChatHistory
  sessionId?: string | boolean
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

export async function app ({ start = false, logger }: AppOptions) {
  const app = fastify({    logger  })

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const chatConfig: FastifyAiRouteConfig = {
    context: 'You are a nice helpful assistant.',
    temperature: 0.5,
    maxTokens: 250,
    // TODO stream
    // rate limit, timeout, lifetime (sessionId)

    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'

        // TODO override
        // temperature
        // maxTokens
        // timeout
        // rate limit
      }
    ]
  }
  // TODO translations / single prompt, no session

  // TODO naming: session?
  await app.register(ai, {
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        // TODO baseURL: process.env.OPENAI_BASE_URL
      }
    },
    storage: valkeyStorage

    // TODO default values
    // rateLimit: {
    //     max: 100,
    //     timeWindow: '1m'
    // },
    // timeout: 10_000 // ms
  })

  // TODO app.post('/prompt', async (request, reply) => {
  // const { prompt, context, maxTokens, temperature, sessionId } = request.body

  app.post('/chat', { config: { ai: chatConfig } }, async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply) => {
    // TODO auth
    const { prompt, stream, history, sessionId } = request.body

    const response = await app.ai.request({
      request,
      prompt,
      stream,
      history,
      sessionId,
    }, reply)

    return response
  })

  app.get('/history', async (request: FastifyRequest<{ Querystring: { sessionId: string } }>, reply) => {
    const history = await app.ai.retrieveHistory(request.query.sessionId)
    return history
  })

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000

  if (start) {
    await app.listen({ host: process.env.HOST || '0.0.0.0', port })
  }

  return app
}
