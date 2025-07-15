import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { Ai, type AiOptions, type AiModel, type AiResponseResult } from '@platformatic/ai-provider'
import type { AiChatHistory, AiSessionId } from '@platformatic/ai-provider'

const DEFAULT_HEADER_SESSION_ID_NAME = 'x-session-id'

export type AiPluginOptions = AiOptions & {
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
}

export type ContentResponse = {
  text: string
  result: AiResponseResult
  sessionId?: AiSessionId
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

  const ai = new Ai(options)
  // TODO try/catch, valkey connection error
  await ai.init()

  // TODO ai.close on shutdown

  fastify.decorate('ai', {
    request: async (request: FastifyAiRequest, reply: FastifyReply): Promise<FastifyAiResponse> => {
      const response = await ai.request({
        models: request.models ?? options.models,
        prompt: request.prompt,
        options: {
          context: request.context,
          temperature: request.temperature,
          stream: request.stream,
          history: request.history,
          sessionId: request.sessionId
        }
      })

      if (response.sessionId) {
        reply.header(options.headerSessionIdName!, response.sessionId)
      }

      if (request.stream) {
        reply.header('content-type', 'text/event-stream')

        // TODO response error
        return response
      }

      // TODO response error
      return response
    },

    retrieveHistory: async (sessionId: string) => {
      return await ai.history.range(sessionId)
    }
  })
})
