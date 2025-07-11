import { test } from 'node:test'
import assert from 'node:assert'
import jwt from 'jsonwebtoken'
import { Ai, type ContentResponse } from '../src/lib/ai.ts'
import { createDummyClient, createJWT } from './helper/helper.ts'
import pino from 'pino'

const apiKey = 'test'
const logger = pino({ level: 'silent' })
const jwtSecret = 'test-secret-key'

test('should allow requests when no auth is configured', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'No auth required' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello'
  }) as ContentResponse

  assert.equal(response.text, 'No auth required')
})

test('should throw AuthenticationRequiredError when auth is configured but no token provided', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello'
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_REQUIRED_ERROR')
      return true
    }
  )
})

test('should allow requests with valid JWT token', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Authenticated successfully' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'user123',
    iat: now,
    exp: now + 3600, // 1 hour from now
    aud: 'ai-service'
  }

  const validToken = createJWT(payload, jwtSecret)

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello',
    auth: { jwt: validToken }
  }) as ContentResponse

  assert.equal(response.text, 'Authenticated successfully')
})

test('should throw AuthenticationInvalidTokenError with malformed JWT token', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello',
        auth: { jwt: 'invalid.token' }
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_INVALID_TOKEN_ERROR')
      // The jsonwebtoken library provides its own error messages
      return true
    }
  )
})

test('should throw AuthenticationInvalidTokenError with invalid signature', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'user123',
    iat: now,
    exp: now + 3600,
    aud: 'ai-service'
  }

  // Create token with wrong secret
  const invalidToken = createJWT(payload, 'wrong-secret')

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello',
        auth: { jwt: invalidToken }
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_INVALID_TOKEN_ERROR')
      // The jsonwebtoken library provides its own error messages
      return true
    }
  )
})

test('should throw AuthenticationTokenExpiredError with expired JWT token', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'user123',
    iat: now - 7200, // 2 hours ago
    exp: now - 3600, // 1 hour ago (expired)
    aud: 'ai-service'
  }

  const expiredToken = createJWT(payload, jwtSecret)

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello',
        auth: { jwt: expiredToken }
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_TOKEN_EXPIRED_ERROR')
      return true
    }
  )
})

test('should throw AuthenticationInvalidTokenError with unsupported algorithm', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'user123',
    iat: now,
    exp: now + 3600,
    aud: 'ai-service'
  }

  // Create a token with none algorithm (which is unsupported)
  const invalidToken = jwt.sign(payload, '', { algorithm: 'none' })

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello',
        auth: { jwt: invalidToken }
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_INVALID_TOKEN_ERROR')
      // The error message will vary based on the actual JWT error
      return true
    }
  )
})

test('should throw AuthenticationInvalidTokenError with token not yet valid (nbf)', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'user123',
    iat: now,
    exp: now + 3600,
    nbf: now + 1800, // Not valid before 30 minutes from now
    aud: 'ai-service'
  }

  const futureToken = createJWT(payload, jwtSecret)

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello',
        auth: { jwt: futureToken }
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_INVALID_TOKEN_ERROR')
      assert.ok(error.message.includes('Token not yet valid'))
      return true
    }
  )
})

test('should work with valid token containing various claims', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Token with claims works' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: 'user123',
    iat: now,
    exp: now + 3600,
    aud: 'ai-service',
    custom: 'claim'
  }

  const validToken = createJWT(payload, jwtSecret)

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello',
    auth: { jwt: validToken }
  }) as ContentResponse

  assert.equal(response.text, 'Token with claims works')
})

test('should handle token verification errors gracefully', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Should not reach here' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }],
    auth: {
      jwt: {
        secret: jwtSecret,

      }
    }
  })
  await ai.init()

  // Create a completely invalid token that will cause JWT parsing to fail
  const invalidToken = 'completely.invalid.token'

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['openai:gpt-4o-mini'],
        prompt: 'Hello',
        auth: { jwt: invalidToken }
      })
    },
    (error: any) => {
      assert.equal(error.code, 'AUTHENTICATION_INVALID_TOKEN_ERROR')
      // The error message will vary based on the actual JWT error
      return true
    }
  )
})
