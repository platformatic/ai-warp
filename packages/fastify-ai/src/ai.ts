import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Logger } from 'pino'
import { Ai } from '@platformatic/ai-provider'
import type { AiOptions, AiModel, AiResponseResult, AiChatHistory, AiSessionId } from '@platformatic/ai-provider'
import type { FastifyUserPluginOptions } from 'fastify-user'

const DEFAULT_HEADER_SESSION_ID_NAME = 'x-session-id'

export type AiPluginOptions = Omit<AiOptions, 'logger'> & {
  headerSessionIdName?: string
  user?: FastifyUserPluginOptions
}

export type FastifyAiRequest = {
  request: FastifyRequest
  prompt: string
  context?: string
  temperature?: number
  models?: AiModel[]
  stream?: boolean
  history?: AiChatHistory
  sessionId?: AiSessionId
}

export type ContentResponse = {
  text: string
  result: AiResponseResult
  sessionId: AiSessionId
}

export type FastifyAiResponse = ContentResponse | ReadableStream

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (request: FastifyAiRequest, reply: FastifyReply) => Promise<FastifyAiResponse>
      retrieveHistory: (sessionId: AiSessionId) => Promise<AiChatHistory>
    }
  }
}

export default fp(async (fastify, options: AiPluginOptions) => {
  if (!options.headerSessionIdName) {
    options.headerSessionIdName = DEFAULT_HEADER_SESSION_ID_NAME
  }

  // Register fastify-user if user options are provided
  if (options.user) {
    // @ts-ignore
    const fastifyUserModule = await import('fastify-user')
    // @ts-ignore
    await fastify.register(fastifyUserModule.default, options.user)

    // Add preHandler hook to extract user from JWT
    fastify.addHook('preHandler', async (request, _reply) => {
      // @ts-ignore
      await request.extractUser()
    })
  }

  const aiOptions: AiOptions = {
    ...options,
    logger: fastify.log as Logger
  }

  const ai = new Ai(aiOptions)
  // TODO try/catch, valkey connection error
  await ai.init()

  fastify.decorate('ai', {
    request: async (request: FastifyAiRequest, reply: FastifyReply): Promise<FastifyAiResponse> => {
      const response = await ai.request({
        models: request.models,
        prompt: request.prompt,
        options: {
          context: request.context,
          temperature: request.temperature,
          stream: request.stream,
          history: request.history,
          sessionId: request.sessionId
        }
      })
      reply.header(options.headerSessionIdName!, response.sessionId)

      if (request.stream) {
        reply.header('content-type', 'text/event-stream')

        // TODO response error
        return response
      }

      reply.header('content-type', 'application/json')
      // TODO response error
      return response
    },

    retrieveHistory: async (sessionId: string) => {
      return await ai.history.range(sessionId)
    }
  })

  fastify.addHook('onClose', async () => {
    await ai.close()
  })
})
