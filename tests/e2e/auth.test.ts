/* eslint-disable @typescript-eslint/no-floating-promises */
import { it } from 'node:test'
import assert from 'node:assert'
import { buildAiWarpApp } from '../utils/stackable.js'
import { AiWarpConfig } from '../../config.js'
import { authConfig, createToken } from '../utils/auth.js'
import { mockAllProviders } from '../utils/mocks/index.js'
mockAllProviders()

const aiProvider: AiWarpConfig['aiProvider'] = {
  openai: {
    model: 'gpt-3.5-turbo',
    apiKey: ''
  }
}

it('returns 401 for unauthorized user', async () => {
  const [app, port] = await buildAiWarpApp({
    aiProvider,
    auth: {
      required: true
    }
  })

  try {
    await app.start()

    const response = await fetch(`http://localhost:${port}`)
    assert.strictEqual(response.status, 401)
  } finally {
    await app.close()
  }
})

it('returns 200 for authorized user', async () => {
  const [app, port] = await buildAiWarpApp({
    aiProvider,
    auth: authConfig
  })

  try {
    await app.start()

    const response = await fetch(`http://localhost:${port}`, {
      headers: {
        Authorization: `Bearer ${createToken({ asd: '123' })}`
      }
    })
    assert.strictEqual(response.status, 200)
  } finally {
    await app.close()
  }
})
