import fastify, { type FastifyRequest, type FastifyReply } from 'fastify'
import ai from '../src/plugins/ai.ts'

interface AppOptions {
  start?: boolean
}

interface ChatRequestBody {
  prompt: string
  sessionId?: string
}

interface AiPluginOptions {
  providers: {
    openai: {
      apiKey: string | undefined
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (query: {
        request: FastifyRequest
        prompt: string
        sessionId?: string
      }) => Promise<any>
    }
  }
}

export async function app ({ start = false }: AppOptions) {
  const app = fastify({
    logger: {
      level: 'error'
    }
  })

  const chatConfig = {
    // TODO context: '...', // optional
    temperature: 0.5, // optional, default
    maxTokens: 1000, // optional, default
    // TODO stream
    // rate limit, timeout, lifetime (sessionId)

    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',

        // TODO override
        // temperature
        // maxTokens
        // timeout
        // rate limit
        // override apiKeys? baseUrl?
      }
    ]
  }
  // TODO translations / single prompt, no session

  // TODO naming: session?
  app.register(ai, {
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        // TODO baseURL: process.env.OPENAI_BASE_URL
      }
    }

    // TODO defaults
    // rateLimit: {
    //     max: 100,
    //     timeWindow: '1m'
    // },
    // timeout: 10_000 // ms
  } as AiPluginOptions)

  // TODO app.post('/prompt', async (request, reply) => {
  // const { prompt, context, maxTokens, temperature, sessionId } = request.body

  app.post('/chat', { config: { ai: chatConfig } }, async (request: FastifyRequest<{ Body: ChatRequestBody }>, reply) => {
    // TODO auth
    const { prompt, sessionId } = request.body
    // // TODO resume flow by sessionId

    const response = await app.ai.request({
      // request,
      prompt,
      sessionId,
      // TODO stream: true
    })

    return response
  })

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000

  if (start) {
    await app.listen({ host: process.env.HOST || '0.0.0.0', port })
  }

  return app
}
