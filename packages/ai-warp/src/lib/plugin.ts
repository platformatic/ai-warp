import { createError } from '@fastify/error'
import { Type } from '@fastify/type-provider-typebox'
import ai, { type AiChatHistory, type AiSessionId } from '@platformatic/fastify-ai'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import fastifyUser from 'fastify-user'
import type { AIWarpConfiguration } from '../config.d.ts'

const DEFAULT_PROMPT_PATH = '/api/v1/prompt'
const DEFAULT_STREAM_PATH = '/api/v1/stream'

export type AiRequestBody = {
  prompt: string
  context?: string
  temperature?: number
  history?: AiChatHistory
  sessionId?: AiSessionId
}

const InternalServerError = createError('INTERNAL_SERVER_ERROR', 'Internal Server Error', 500)
const UnauthorizedError = createError('UNAUTHORIZED', 'Unauthorized', 401)
function isAFastifyError (object: object): object is FastifyError {
  return 'code' in object && 'name' in object
}

export async function aiWarp (app: FastifyInstance, config: AIWarpConfiguration) {
  await app.register(ai, config.ai as any)

  // Register fastify-user if auth options are provided
  if (config.auth) {
    // @ts-ignore
    await app.register(fastifyUser, config.auth)

    // Add onRequest hook to extract user from JWT and check auth
    app.addHook('onRequest', async (request, _reply) => {
      await request.extractUser()

      // Check if user is required but missing
      const isAuthRequired = config.auth?.required === true
      // @ts-ignore
      const isMissingUser = request.user === undefined || request.user === null

      if (isAuthRequired && isMissingUser) {
        throw new UnauthorizedError()
      }
    })
  }

  const bodySchema = Type.Object({
    context: Type.Optional(Type.String()),
    temperature: Type.Optional(Type.Number()),
    prompt: Type.String(),
    history: Type.Optional(
      Type.Array(
        Type.Object({
          prompt: Type.String(),
          response: Type.String()
        })
      )
    ),
    sessionId: Type.Optional(Type.String())
  })

  app.route({
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
        const response = await app.ai.request(
          {
            request,
            prompt,
            context,
            temperature,
            history,
            sessionId,
            stream: false
          },
          reply
        )

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

  app.route({
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
        const response = await app.ai.request(
          {
            request,
            prompt,
            context,
            temperature,
            history,
            sessionId,
            stream: true
          },
          reply
        )

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

  // TODO client rate limit with @fastify/rate-limit on ai-warp service
}

export const plugin = fp(aiWarp)
