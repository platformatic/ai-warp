import fp from 'fastify-plugin'
import { Ai, type AiOptions, type Model, type ResponseResult } from '../lib/ai.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ChatHistory } from '../lib/provider.ts'

const DEFAULT_HEADER_SESSION_ID_NAME = 'x-session-id'

export type AiPluginOptions = AiOptions & {
  headerSessionIdName?: string
}

export type FastifyAiRequest = {
  request: FastifyRequest
  prompt: string
  context?: string
  temperature?: number
  models?: Model[]
  stream?: boolean
  history?: ChatHistory
  sessionId?: string | boolean // TODO doc sessionId and history are mutually exclusive
}

export type ContentResponse = {
  text: string
  result: ResponseResult
  sessionId?: string
}

export type FastifyAiResponse = ContentResponse | ReadableStream

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (request: FastifyAiRequest, reply: FastifyReply) => Promise<FastifyAiResponse>
      retrieveHistory: (sessionId: string) => Promise<ChatHistory>
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
      // TODO validate request
      // sessionId and history are mutually exclusive

      const jwt = options.auth
        ? request.request.headers.authorization?.substring(7).trim() // 7 == 'Bearer '.length
        : undefined

      const response = await ai.request({
        models: request.models ?? options.models,
        prompt: request.prompt,
        auth: { jwt },
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
