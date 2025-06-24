import fp from 'fastify-plugin'
import { createProviders } from '../providers/providers.ts'
import type { ProviderResponse, QueryRequest } from '../lib/ai.ts'

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      request: (query: QueryRequest) => Promise<ProviderResponse>
    }
  }
}

export default fp((fastify, options) => {
//   console.log('ai', options)
// TODO validate options

  const providersOptions = {
    // TODO settings: timeout, rateLimit, ...
    providers: {
      openai: {
        // apiKey: options.providers.openai.apiKey,
        // TODO baseURL: process.env.OPENAI_BASE_URL
      }
    }
  }
  const providers = createProviders(providersOptions)

  fastify.addHook('preHandler', async (request, reply) => {
    // request.routeOptions.config
    // TODO merge with global config
    // console.log('preHandler', config)
    // request.routeOptions.config.default = 'TODO'
  })

  fastify.decorate('ai', {
    request: async (query: QueryRequest): Promise<ProviderResponse> => {
      // console.log('request', request, options)
      // console.log('request config', query.request.routeOptions.config)

      return {
        text: 'TODO'
      }
    }
  })
})
