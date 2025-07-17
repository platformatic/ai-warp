import { PlatformaticApp } from '@platformatic/service'
import { AiWarpConfig } from './config.js'

declare module 'fastify' {
  interface FastifyInstance {
    platformatic: PlatformaticApp<AiWarpConfig>
  }
}

export { PlatformaticApp, AiWarpConfig }
