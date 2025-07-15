import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Logger } from 'pino'
import { createError } from '@fastify/error'
import { Type } from '@fastify/type-provider-typebox'

import { Ai, type AiOptions, type AiModel, type AiResponseResult, type AiChatHistory, type AiSessionId } from '@platformatic/ai-provider'

const DEFAULT_HEADER_SESSION_ID_NAME = 'x-session-id'
const DEFAULT_PROMPT_PATH = '/api/v1/prompt'
const DEFAULT_STREAM_PATH = '/api/v1/stream'

export type AiPluginOptions = Omit< AiOptions, 'logger'> & {
  headerSessionIdName?: string
  promptPath?: string
  streamPath?: string
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

export type AiRequestBody = {
  prompt: string
  context?: string
  temperature?: number
  history?: AiChatHistory
  sessionId?: AiSessionId
}

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (request: FastifyAiRequest, reply: FastifyReply) => Promise<FastifyAiResponse>
      retrieveHistory: (sessionId: AiSessionId) => Promise<AiChatHistory>
    }
  }
}

const InternalServerError = createError('INTERNAL_SERVER_ERROR', 'Internal Server Error', 500)
function isAFastifyError (object: object): object is FastifyError {
  return 'code' in object && 'name' in object
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

  const bodySchema = Type.Object({
    context: Type.Optional(Type.String()),
    temperature: Type.Optional(Type.Number()),
    prompt: Type.String(),
    history: Type.Optional(Type.Array(Type.Object({
      prompt: Type.String(),
      response: Type.String()
    }))),
    sessionId: Type.Optional(Type.String())
  })

  fastify.route({
    url: options.promptPath ?? DEFAULT_PROMPT_PATH,
    method: 'POST',
    schema: {
      operationId: 'prompt',
      body: bodySchema,
      response: {
        200: Type.Object({
          text: Type.String(),
          result: Type.String(),
          sessionId: Type.String()
        }),
        default: Type.Object({
          code: Type.Optional(Type.String()),
          message: Type.String()
        })
      }
    },
    handler: async (request: FastifyRequest<{ Body: AiRequestBody }>, reply: FastifyReply) => {
      try {
        const { prompt, context, temperature, history, sessionId } = request.body
        const response = await fastify.ai.request({
          request,
          prompt,
          context,
          temperature,
          history,
          sessionId,
          stream: false
        }, reply)

        return reply.send(response)
      } catch (error) {
        if (error instanceof Object && isAFastifyError(error)) {
          return error
        } else {
          const err = new InternalServerError()
          err.cause = error
          throw err
        }
      }
    }
  })

  fastify.route({
    url: options.streamPath ?? DEFAULT_STREAM_PATH,
    method: 'POST',
    schema: {
      operationId: 'stream',
      produces: ['text/event-stream'],
      body: bodySchema
    },
    handler: async (request: FastifyRequest<{ Body: AiRequestBody }>, reply: FastifyReply) => {
      try {
        const { prompt, context, temperature, history, sessionId } = request.body
        const response = await fastify.ai.request({
          request,
          prompt,
          context,
          temperature,
          history,
          sessionId,
          stream: true
        }, reply)

        return reply.send(response)
      } catch (error) {
        if (error instanceof Object && isAFastifyError(error)) {
          return error
        } else {
          const err = new InternalServerError()
          err.cause = error
          throw err
        }
      }
    }
  })

  // TODO auth with @platformatic/fastify-user
  // TODO client rate limit with @fastify/rate-limit

  fastify.addHook('onClose', async () => {
    await ai.close()
  })
})
