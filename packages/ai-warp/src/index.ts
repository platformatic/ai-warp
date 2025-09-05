import type { ConfigurationOptions } from '@platformatic/foundation'
import { create as createService, platformaticService, ServiceCapability } from '@platformatic/service'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import type { AIWarpConfiguration } from './config.d.ts'
import { plugin } from './lib/plugin.ts'
import { schema } from './lib/schema.ts'

export async function aiWarp (app: FastifyInstance, capability: ServiceCapability) {
  const config = (await capability.getConfig()) as AIWarpConfiguration
  await platformaticService(app, capability)
  await app.register(plugin, config)
}

export async function create (
  root: string | AIWarpConfiguration,
  source?: string | AIWarpConfiguration,
  context?: ConfigurationOptions
) {
  return createService(root, source, { schema, applicationFactory: fp(aiWarp), ...context })
}

export { Generator } from './lib/generator.ts'
export { packageJson, schema, schemaComponents, version } from './lib/schema.ts'
