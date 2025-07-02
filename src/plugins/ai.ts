import fp from 'fastify-plugin'
import { Ai, DEFAULT_HISTORY_EXPIRATION, DEFAULT_MAX_RETRIES, DEFAULT_RATE, DEFAULT_REQUEST_TIMEOUT, DEFAULT_RETRY_INTERVAL, type AiOptions, type AiProvider } from '../lib/ai.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ChatHistory } from '../lib/provider.ts'

export type AiPluginOptions = AiOptions

export type AiLimits = {
  maxTokens?: number
  rate?: {
    max: number
    timeWindow: number | string
  }
  requestTimeout?: number // provider request timeout
  retry?: {
    max: number
    interval: number
  }
  historyExpiration?: number | string // history expiration time
}

export type FastifyAiRouteConfig = {
  models: Array<{
    provider: AiProvider
    model: string
    limits?: AiLimits
  }>
  context?: string
  temperature?: number
  limits?: AiLimits

  // computed options for the handler
  _handlerOptions?: {
    models: Array<{
      provider: AiProvider
      model: string
      limits?: AiLimits
    }>
    context?: string
    temperature?: number
    limits: AiLimits
  }
}

export type FastifyAiRequest = {
  request: FastifyRequest
  prompt: string
  stream?: boolean
  history?: ChatHistory
  sessionId?: string | boolean // TODO doc sessionId and history are mutually exclusive
}

export type FastifyAiResponse = {
  text: string
  sessionId?: string
} | ReadableStream

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (request: FastifyAiRequest, reply: FastifyReply) => Promise<FastifyAiResponse>
      retrieveHistory: (sessionId: string) => Promise<ChatHistory>
    }
  }

  interface FastifyContextConfig {
    ai?: FastifyAiRouteConfig
  }
}

export default fp(async (fastify, options: AiPluginOptions) => {
  // TODO validate options
  const ai = new Ai(options)
  // TODO try/catch
  await ai.init()

  fastify.addHook('onRoute', (routeOptions) => {
    const aiRouteOptions = routeOptions?.config?.ai as FastifyAiRouteConfig
    if (!aiRouteOptions) {
      return
    }

    // TODO validate routeOptions
    const models = aiRouteOptions.models.map(model => ({
      provider: model.provider as AiProvider,
      model: model.model,
      limits: model.limits
    }))

    aiRouteOptions._handlerOptions = {
      models,
      context: aiRouteOptions.context,
      temperature: aiRouteOptions.temperature,
      limits: {
        maxTokens: aiRouteOptions.limits?.maxTokens, // can be undefined
        rate: aiRouteOptions.limits?.rate ?? DEFAULT_RATE,
        requestTimeout: aiRouteOptions.limits?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
        historyExpiration: aiRouteOptions.limits?.historyExpiration ?? DEFAULT_HISTORY_EXPIRATION,
        retry: {
          max: aiRouteOptions.limits?.retry?.max ?? DEFAULT_MAX_RETRIES,
          interval: aiRouteOptions.limits?.retry?.interval ?? DEFAULT_RETRY_INTERVAL
        }
      }
    }

    ai.addModels(models)
  })

  fastify.decorate('ai', {
    request: async (request: FastifyAiRequest, reply: FastifyReply): Promise<FastifyAiResponse> => {
      const options = (request.request.routeOptions.config.ai as FastifyAiRouteConfig)._handlerOptions!
      if (!options) {
        // TODO log, throw error missing config
      }

      // TODO validate request params
      // sessionId and history are mutually exclusive

      const response = await ai.request({
        models: options.models,
        prompt: request.prompt,
        options: {
          context: options.context,
          temperature: options.temperature,
          stream: request.stream,
          history: request.history,
          sessionId: request.sessionId,
          limits: options.limits
        }
      })

      if (request.stream) {
        reply.header('content-type', 'text/event-stream')

        if (response.sessionId) {
          // TODO config header name
          reply.header('x-session-id', response.sessionId)
        }
        // TODO response error
        return response
      }

      if (response instanceof ReadableStream) {
        throw new Error('Unexpected ReadableStream response for non-streaming request')
      }

      if (response.sessionId) {
        // TODO config header name
        reply.header('x-session-id', response.sessionId)
      }

      // TODO response error
      return response
    },

    retrieveHistory: async (sessionId: string) => {
      return await ai.history.range(sessionId)
    }
  })
})
