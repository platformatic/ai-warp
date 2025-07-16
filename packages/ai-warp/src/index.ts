import type { FastifyInstance } from 'fastify'
import { app as platformaticService, type Stackable, buildStackable as serviceBuildStackable } from '@platformatic/service'
import { ConfigManager } from '@platformatic/config'
import type { StackableInterface } from '@platformatic/config'
import ai from '@platformatic/fastify-ai'
import { schema } from './lib/schema.js'
import { Generator } from './lib/generator.js'
import type { AiWarpConfig } from '../config.js'

export interface AiWarpMixin {
  platformatic: {
    configManager: ConfigManager<AiWarpConfig>
    config: AiWarpConfig
  }
}

type AiGenerator = new () => Generator

async function buildStackable (opts: { config: string }): Promise<StackableInterface> {
  return await serviceBuildStackable(opts, stackable)
}

const stackable: Stackable<AiWarpConfig, AiGenerator> = {
  async app (app: FastifyInstance, options: object) {
    const fastify = app as unknown as FastifyInstance & AiWarpMixin
    const { config } = fastify.platformatic

    await fastify.register(platformaticService, config)
    await fastify.register(ai, config.ai)
  },
  configType: 'ai-warp-app',
  schema,
  Generator,
  configManagerConfig: {
    schema,
    envWhitelist: ['PORT', 'HOSTNAME'],
    allowToWatch: ['.env'],
    schemaOptions: {
      useDefaults: true,
      coerceTypes: true,
      allErrors: true,
      strict: false
    },
    async transformConfig () {}
  },
  buildStackable
}

// break Fastify encapsulation

// @ts-expect-error
stackable.app[Symbol.for('skip-override')] = true

export default stackable
export { Generator, schema, buildStackable }
