import { test } from 'node:test'
import assert from 'node:assert'
import { createSigner } from 'fast-jwt'
import { createApp, createDummyClient } from './helper.ts'

const SECRET = 'test-secret-key-for-jwt'

test('should extract user from valid JWT token', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello user' }, finish_reason: 'stop' }] }
    }
  }

  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ client, authConfig })

  // Add a route to test user extraction
  app.route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start()

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

  await app.close()
})

test('should reject requests with invalid JWT token', async () => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ authConfig })

  // Add a route to test user extraction
  app.route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start()

  const response = await app.inject({
    method: 'GET',
    url: '/user',
    headers: {
      authorization: 'Bearer invalid-token'
    }
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body)
  assert.equal(body.message, 'Unauthorized')

  await app.close()
})

test('should reject requests with missing JWT token', async () => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ authConfig })

  // Add a route to test user extraction
  app.route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start()

  const response = await app.inject({
    method: 'GET',
    url: '/user'
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body)
  assert.equal(body.message, 'Unauthorized')

  await app.close()
})

test('should populate request.user for AI endpoints', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello authenticated user' }, finish_reason: 'stop' }] }
    }
  }

  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ client, authConfig })

  // Add a hook to verify user is populated
  app.addHook('onRequest', async (request, _reply) => {
    if (request.url === '/api/v1/prompt') {
      // @ts-ignore
      assert.ok(request.user, 'User should be populated')
      // @ts-ignore
      assert.equal(request.user.sub, 'user123')
    }
  })

  await app.start()

  const payload = { sub: 'user123', name: 'Test User' }
  const signer = createSigner({ key: SECRET })
  const token = signer(payload)

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
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

  await app.close()
})

test('should work with JWT namespace option', async () => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET,
      namespace: 'https://example.com/'
    }
  }

  const [app, _port] = await createApp({ authConfig })

  // Add a route to test user extraction
  app.route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start()

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

  await app.close()
})

test('should reject unauthenticated requests to AI endpoints when auth is configured', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }
    }
  }

  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ client, authConfig })
  await app.start()

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body)
  assert.equal(body.message, 'Unauthorized')

  await app.close()
})

test('should reject unauthenticated requests to custom routes when auth is configured', async () => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ authConfig })

  // Add a route to test auth enforcement
  app.route({
    url: '/test',
    method: 'GET',
    handler: async (_request, _reply) => {
      return { message: 'success' }
    }
  })

  await app.start()

  const response = await app.inject({
    method: 'GET',
    url: '/test'
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body)
  assert.equal(body.message, 'Unauthorized')

  await app.close()
})

test('should not enforce auth when required is false', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }
    }
  }

  const authConfig = {
    required: false,
    jwt: {
      secret: SECRET
    }
  }

  const [app, _port] = await createApp({ client, authConfig })
  await app.start()

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.text, 'Hello')

  await app.close()
})

test('should work without auth options', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }
    }
  }

  const [app, _port] = await createApp({ client })
  await app.start()

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.text, 'Hello')

  await app.close()
})
