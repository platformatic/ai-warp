import fp from 'fastify-plugin'
// import { createProviders } from '../providers/providers.ts'

export interface AiPluginOptions {
  providers: {
    openai: {
      apiKey: string | undefined
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
//   console.log('ai', options)
// TODO validate options

  // const providersOptions = {
  //   // TODO settings: timeout, rateLimit, ...
  //   providers: {
  //     openai: {
  //       // apiKey: options.providers.openai.apiKey,
  //       // TODO baseURL: process.env.OPENAI_BASE_URL
  //     }
  //   }
  // }
  // const providers = createProviders(providersOptions)

  fastify.addHook('preHandler', async (request, reply) => {
    // TODO
    // request.routeOptions.config
    // TODO merge with global config
    // console.log('preHandler', config)
    // request.routeOptions.config.default = 'TODO'
  })

  fastify.decorate('ai', {
    request: async (request: FastifyAiRequest): Promise<FastifyAiResponse> => {
      // console.log('request', request, options)
      // console.log('request config', query.request.routeOptions.config)

      return {
        text: 'TODO'
      }
    }
  })
})
