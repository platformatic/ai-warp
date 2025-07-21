import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Logger } from 'pino'
import type { Readable } from 'node:stream'
import { Ai } from '@platformatic/ai-provider'
import type { AiOptions, AiModel, AiResponseResult, AiChatHistory, AiSessionId } from '@platformatic/ai-provider'

const DEFAULT_HEADER_SESSION_ID_NAME = 'x-session-id'

export type AiPluginOptions = Omit<AiOptions, 'logger'> & {
  headerSessionIdName?: string
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
  resume?: boolean
}

export type ContentResponse = {
  text: string
  result: AiResponseResult
  sessionId: AiSessionId
}

export type FastifyAiResponse = ContentResponse | Readable

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
        resume: request.resume,
        options: {
          context: request.context,
          temperature: request.temperature,
          stream: request.stream,
          history: request.history,
          sessionId: request.sessionId
        }
      } as any)
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
