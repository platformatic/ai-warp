import fp from 'fastify-plugin'
import { Ai, type AiOptions, type AiProvider } from '../lib/ai.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ChatHistory } from '../lib/provider.ts'

export type AiPluginOptions = AiOptions

export type FastifyAiRouteConfig = {
  models: Array<{
    provider: AiProvider
    model: string
  }>
  context?: string
  maxTokens?: number
  temperature?: number

  handlerOptions?: {
    models: Array<{
      provider: AiProvider
      model: string
    }>
    context?: string
    maxTokens?: number
    temperature?: number
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
      model: model.model
    }))

    // TODO use request decorator
    aiRouteOptions.handlerOptions = {
      models,
      context: aiRouteOptions.context,
      maxTokens: aiRouteOptions.maxTokens,
      temperature: aiRouteOptions.temperature
    }

    ai.addModels(models)
  })

  fastify.decorate('ai', {
    request: async (request: FastifyAiRequest, reply: FastifyReply): Promise<FastifyAiResponse> => {
      // console.log('request', request.prompt)
      // console.log('request config', request.request.routeOptions.config.ai)

      // TODO merge request.request.routeOptions.config.ai with default config

      const options = (request.request.routeOptions.config.ai as FastifyAiRouteConfig).handlerOptions!
      if (!options) {
        // TODO log, throw error missing config
      }

      // TODO check sessionId and history are mutually exclusive

      const response = await ai.request({
        models: options.models,
        prompt: request.prompt,
        options: {
          context: options.context,
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          stream: request.stream,
          history: request.history,
          sessionId: request.sessionId
        }
      })

      if (request.stream) {
        reply.header('content-type', 'text/event-stream')

        if (response.sessionId) {
          // TODO config header name
          reply.header('x-session-id', response.sessionId)
        }
        return response
      }

      if (response instanceof ReadableStream) {
        throw new Error('Unexpected ReadableStream response for non-streaming request')
      }

      if (response.sessionId) {
        // TODO config header name
        reply.header('x-session-id', response.sessionId)
      }
      return response
    },

    retrieveHistory: async (sessionId: string) => {
      return await ai.history.range(sessionId)
    }
  })
})
