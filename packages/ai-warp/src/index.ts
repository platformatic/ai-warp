import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Type } from '@fastify/type-provider-typebox'
import { createError } from '@fastify/error'
import { app as platformaticService, type Stackable, buildStackable as serviceBuildStackable } from '@platformatic/service'
import { ConfigManager } from '@platformatic/config'
import type { StackableInterface } from '@platformatic/config'
import ai, { type AiChatHistory, type AiSessionId } from '@platformatic/fastify-ai'
import { schema } from './lib/schema.js'
import { Generator } from './lib/generator.js'
import type { AiWarpConfig } from '../config.js'

const DEFAULT_PROMPT_PATH = '/api/v1/prompt'
const DEFAULT_STREAM_PATH = '/api/v1/stream'

export interface AiWarpMixin {
  platformatic: {
    configManager: ConfigManager<AiWarpConfig>
    config: AiWarpConfig
  }
}

export type AiRequestBody = {
  prompt: string
  context?: string
  temperature?: number
  history?: AiChatHistory
  sessionId?: AiSessionId
}

const InternalServerError = createError('INTERNAL_SERVER_ERROR', 'Internal Server Error', 500)
function isAFastifyError (object: object): object is FastifyError {
  return 'code' in object && 'name' in object
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
      url: config.ai.promptPath ?? DEFAULT_PROMPT_PATH,
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
      url: config.ai.streamPath ?? DEFAULT_STREAM_PATH,
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

    // TODO auth with @platformatic/fastify-user on ai-warp service

    // await fastify.register(fastifyUser as any, config.auth)

    // TODO client rate limit with @fastify/rate-limit on ai-warp service
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
