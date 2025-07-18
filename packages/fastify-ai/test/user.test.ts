import { test } from 'node:test'
import assert from 'node:assert'
import fastify from 'fastify'
import pino from 'pino'
import { createSigner } from 'fast-jwt'
import ai, { type AiPluginOptions } from '../src/index.ts'
import { createDummyClient } from './helper/helper.ts'
import type { AiChatHistory } from '@platformatic/ai-provider'

const SECRET = 'test-secret-key-for-jwt'

async function createAppWithAuth (options: { client: any, jwtSecret: string, logger?: any }) {
  const logger = options.logger || pino({ level: 'silent' })
  const app = fastify({ loggerInstance: logger })

  const aiOptions: AiPluginOptions = {
    providers: {
      openai: {
        apiKey: 'test',
        client: options.client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
    ],
    user: {
      jwt: {
        secret: options.jwtSecret
      }
    }
  }

  await app.register(ai, aiOptions)

  app.route({
    url: '/prompt',
    method: 'POST',
    handler: async (request, reply) => {
      const { prompt, context, temperature, history, sessionId } = request.body as {
        prompt: string
        context: string
        temperature: number
        history: AiChatHistory
        sessionId: string
      }

      const response = await app.ai.request({
        request,
        prompt,
        context,
        temperature,
        history,
        sessionId,
        stream: false
      }, reply)

      return reply.send(response)
    }
  })

  app.route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  return app
}

test('should extract user from valid JWT token', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello user' }, finish_reason: 'stop' }] }
    }
  }

  const app = await createAppWithAuth({ client, jwtSecret: SECRET })

  const payload = { sub: 'user123', name: 'Test User' }
  const signer = createSigner({ key: SECRET })
  const token = signer(payload)

  const response = await app.inject({
    method: 'GET',
    url: '/user',
    headers: {
      authorization: `Bearer ${token}`
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.user.sub, 'user123')
  assert.equal(body.user.name, 'Test User')
})

test('should not populate user with invalid JWT token', async () => {
  const client = createDummyClient()
  const app = await createAppWithAuth({ client, jwtSecret: SECRET })

  const response = await app.inject({
    method: 'GET',
    url: '/user',
    headers: {
      authorization: 'Bearer invalid-token'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.user, undefined)
})

test('should not populate user with missing JWT token', async () => {
  const client = createDummyClient()
  const app = await createAppWithAuth({ client, jwtSecret: SECRET })

  const response = await app.inject({
    method: 'GET',
    url: '/user'
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.user, undefined)
})

test('should populate request.user for AI endpoints', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello authenticated user' }, finish_reason: 'stop' }] }
    }
  }

  const app = await createAppWithAuth({ client, jwtSecret: SECRET })

  const payload = { sub: 'user123', name: 'Test User' }
  const signer = createSigner({ key: SECRET })
  const token = signer(payload)

  // Add a hook to verify user is populated
  app.addHook('preHandler', async (request, _reply) => {
    if (request.url === '/prompt') {
      // @ts-ignore
      assert.ok(request.user, 'User should be populated')
      // @ts-ignore
      assert.equal(request.user.sub, 'user123')
    }
  })

  const response = await app.inject({
    method: 'POST',
    url: '/prompt',
    headers: {
      authorization: `Bearer ${token}`
    },
    body: {
      prompt: 'Hello, AI!'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.text, 'Hello authenticated user')
})

test('should work with JWT namespace option', async () => {
  const client = createDummyClient()
  const logger = pino({ level: 'silent' })
  const app = fastify({ loggerInstance: logger })

  const aiOptions: AiPluginOptions = {
    providers: {
      openai: {
        apiKey: 'test',
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
    ],
    user: {
      jwt: {
        secret: SECRET,
        namespace: 'https://example.com/'
      }
    }
  }

  await app.register(ai, aiOptions)

  app.route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  const payload = {
    sub: 'user123',
    'https://example.com/name': 'Test User',
    'https://example.com/role': 'admin'
  }
  const signer = createSigner({ key: SECRET })
  const token = signer(payload)

  const response = await app.inject({
    method: 'GET',
    url: '/user',
    headers: {
      authorization: `Bearer ${token}`
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.user.sub, 'user123')
  assert.equal(body.user.name, 'Test User')
  assert.equal(body.user.role, 'admin')
})

test('should work without user options', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }
    }
  }

  const logger = pino({ level: 'silent' })
  const app = fastify({ loggerInstance: logger })

  const aiOptions: AiPluginOptions = {
    providers: {
      openai: {
        apiKey: 'test',
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
    ]
    // No user options
  }

  await app.register(ai, aiOptions)

  app.route({
    url: '/prompt',
    method: 'POST',
    handler: async (request, reply) => {
      const { prompt } = request.body as { prompt: string }

      const response = await app.ai.request({
        request,
        prompt,
        stream: false
      }, reply)

      return reply.send(response)
    }
  })

  const response = await app.inject({
    method: 'POST',
    url: '/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.text, 'Hello')
})
