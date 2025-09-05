import { createSigner } from 'fast-jwt'
import assert from 'node:assert'
import { test } from 'node:test'
import { createApplication, createDummyClient } from './helper.ts'

const SECRET = 'test-secret-key-for-jwt'

test('should extract user from valid JWT token', async t => {
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

  const app = await createApplication(t, { client, authConfig })

  // Add a route to test user extraction
  app.getApplication().route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

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
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.user.sub, 'user123')
  assert.equal(body.user.name, 'Test User')
})

test('should reject requests with invalid JWT token', async t => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const app = await createApplication(t, { authConfig })

  // Add a route to test user extraction
  app.getApplication().route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start({ listen: true })

  const response = await app.inject({
    method: 'GET',
    url: '/user',
    headers: {
      authorization: 'Bearer invalid-token'
    }
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.message, 'Unauthorized')
})

test('should reject requests with missing JWT token', async t => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const app = await createApplication(t, { authConfig })

  // Add a route to test user extraction
  app.getApplication().route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start({ listen: true })

  const response = await app.inject({
    method: 'GET',
    url: '/user'
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.message, 'Unauthorized')
})

test('should populate request.user for AI endpoints', async t => {
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

  const app = await createApplication(t, { client, authConfig })

  // Add a hook to verify user is populated
  app.getApplication().addHook('onRequest', async (request, _reply) => {
    if (request.url === '/api/v1/prompt') {
      // @ts-ignore
      assert.ok(request.user, 'User should be populated')
      // @ts-ignore
      assert.equal(request.user.sub, 'user123')
    }
  })

  await app.start({ listen: true })

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
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.text, 'Hello authenticated user')
})

test('should work with JWT namespace option', async t => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET,
      namespace: 'https://example.com/'
    }
  }

  const app = await createApplication(t, { authConfig })

  // Add a route to test user extraction
  app.getApplication().route({
    url: '/user',
    method: 'GET',
    handler: async (request, _reply) => {
      // @ts-ignore
      return { user: request.user }
    }
  })

  await app.start({ listen: true })

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
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.user.sub, 'user123')
  assert.equal(body.user.name, 'Test User')
  assert.equal(body.user.role, 'admin')
})

test('should reject unauthenticated requests to AI endpoints when auth is configured', async t => {
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

  const app = await createApplication(t, { client, authConfig })
  await app.start({ listen: true })

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.message, 'Unauthorized')
})

test('should reject unauthenticated requests to custom routes when auth is configured', async t => {
  const authConfig = {
    required: true,
    jwt: {
      secret: SECRET
    }
  }

  const app = await createApplication(t, { authConfig })

  // Add a route to test auth enforcement
  app.getApplication().route({
    url: '/test',
    method: 'GET',
    handler: async (_request, _reply) => {
      return { message: 'success' }
    }
  })

  await app.start({ listen: true })

  const response = await app.inject({
    method: 'GET',
    url: '/test'
  })

  assert.equal(response.statusCode, 401)
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.message, 'Unauthorized')
})

test('should not enforce auth when required is false', async t => {
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

  const app = await createApplication(t, { client, authConfig })
  await app.start({ listen: true })

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.text, 'Hello')
})

test('should work without auth options', async t => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }] }
    }
  }

  const app = await createApplication(t, { client })
  await app.start({ listen: true })

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: {
      prompt: 'Hello!'
    }
  })

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body as unknown as string)
  assert.equal(body.text, 'Hello')
})
