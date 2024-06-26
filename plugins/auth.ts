// eslint-disable-next-line
/// <reference path="../index.d.ts" />
import { FastifyInstance } from 'fastify'
import createError from '@fastify/error'
import fastifyPlugin from 'fastify-plugin'

const UnauthorizedError = createError('UNAUTHORIZED', 'Unauthorized', 401)

export default fastifyPlugin(async (fastify: FastifyInstance) => {
  const { config } = fastify.platformatic

  fastify.addHook('onRequest', async (request) => {
    await request.extractUser()

    const isAuthRequired = config.auth?.required !== undefined && config.auth?.required
    const isMissingUser = request.user === undefined || request.user === null
    if (isAuthRequired && isMissingUser) {
      throw new UnauthorizedError()
    }
  })
})
