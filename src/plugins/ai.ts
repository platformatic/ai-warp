import fp from 'fastify-plugin'
import { Ai, type AiOptions, type ModelOptions } from '../lib/ai.ts'

export type AiPluginOptions = AiOptions

export type FastifyAiRouteConfig = {
  config: {
    ai: {
      models: ModelOptions[]
    }
  }
}

export type FastifyAiRequest = {
  // TODO request: FastifyRequest
  prompt: string
}

export type FastifyAiResponse = {
  text: string
}

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (request: FastifyAiRequest) => Promise<FastifyAiResponse>
    }
  }
}

export default fp((fastify, options: AiPluginOptions) => {
  // TODO validate options
  const ai = new Ai(options)

  fastify.addHook('onRoute', (routeOptions) => {
    const aiRouteOptions = routeOptions?.config?.ai as FastifyAiRouteConfig
    if (!aiRouteOptions) {
      return
    }

    // TODO validate routeOptions
    ai.addModels('openai', aiRouteOptions)
  })

  fastify.decorate('ai', {
    request: async (request: FastifyAiRequest): Promise<FastifyAiResponse> => {
      // console.log('request', request, options)
      // console.log('request config', query.request.routeOptions.config)

      // const response = await ai.request({
      //   models: request.models,
      //   prompt: request.prompt,
      //   options: request.options
      // })
      // return {
      //   text: response.text
      // }

      return {
        text: 'TODO'
      }
    }
  })
})
