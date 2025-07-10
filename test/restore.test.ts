import { mock, test } from 'node:test'
import assert from 'node:assert'
import { setTimeout as wait } from 'node:timers/promises'
import { Ai, type ContentResponse } from '../src/lib/ai.ts'
import pino from 'pino'
import { createDummyClient, setModelState } from './helper/helper.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

interface ExtendedError extends Error {
  code?: string
}

test('should restore model after rate limit error when enough time has passed', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.request = async (_api: any, _request: any, _context: any) => {
    requestCount++
    return {
      choices: [{
        message: {
          content: 'Success after restore'
        }
      }]
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
      model: 'gpt-4o-mini',
      restore: {
        rateLimit: '100ms'
      }
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '200ms'
      }
    }
  })
  await ai.init()

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request'
  })

  // Try to make another request - should hit rate limit and model should be set to error
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Second request'
    }),
    { code: 'PROVIDER_RATE_LIMIT_ERROR' }
  )

  // Verify model state is in error
  const provider = ai.providers.get('openai')!
  const modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'error')
  assert.equal(modelState!.state.reason, 'PROVIDER_RATE_LIMIT_ERROR')

  // Wait for restore timeout
  await wait(500)

  // Should be able to make request again after restore
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Third request after restore'
  }) as ContentResponse

  assert.equal(response.text, 'Success after restore')
  assert.equal(requestCount, 2) // First request + restored request
})

test('should not restore model when not enough time has passed', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.request = async (_api: any, _request: any, _context: any) => {
    requestCount++
    return {
      choices: [{
        message: {
          content: 'Success'
        }
      }]
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
      model: 'gpt-4o-mini',
      restore: {
        rateLimit: '1s' // Long restore time
      }
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request'
  })

  // Try to make another request - should hit rate limit
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Second request'
    }),
    { code: 'PROVIDER_RATE_LIMIT_ERROR' }
  )

  // Wait a short time (not enough for restore)
  await wait(100)

  // Should still not be able to make request
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Third request too soon'
    }),
    { code: 'PROVIDER_NO_MODELS_AVAILABLE_ERROR' }
  )

  assert.equal(requestCount, 1) // Only first request succeeded
})

test('should restore model after timeout error when enough time has passed', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.request = async (_api: any, _request: any, _context: any) => {
    requestCount++
    if (requestCount === 1) {
      await wait(200) // Simulate timeout
      return {
        choices: [{
          message: {
            content: 'Should timeout'
          }
        }]
      }
    }
    return {
      choices: [{
        message: {
          content: 'Success after timeout restore'
        }
      }]
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
      model: 'gpt-4o-mini',
      restore: {
        timeout: '100ms'
      }
    }],
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  // Make a request that will timeout
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Timeout request'
    }),
    { code: 'PROVIDER_REQUEST_TIMEOUT_ERROR' }
  )

  // Verify model state is in error
  const provider = ai.providers.get('openai')!
  const modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'error')
  assert.equal(modelState!.state.reason, 'PROVIDER_REQUEST_TIMEOUT_ERROR')

  // Wait for restore timeout
  await wait(120)

  // Should be able to make request again after restore
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request after timeout restore'
  }) as ContentResponse

  assert.equal(response.text, 'Success after timeout restore')
  assert.equal(requestCount, 2)
})

test('should restore model after stream timeout error when enough time has passed', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.stream = async (_api: any, _request: any, _context: any) => {
    requestCount++
    if (requestCount === 1) {
      await wait(200) // Simulate timeout
      return new ReadableStream({
        start (controller) {
          controller.enqueue(new TextEncoder().encode('{"choices": [{"delta": {"content": "chunk1"}}]}'))
          controller.close()
        }
      })
    }
    return new ReadableStream({
      start (controller) {
        controller.enqueue(new TextEncoder().encode('{"choices": [{"delta": {"content": "restored"}}]}'))
        controller.close()
      }
    })
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
      model: 'gpt-4o-mini',
      restore: {
        timeout: '100ms'
      }
    }],
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  // Make a streaming request that will timeout
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Streaming timeout request',
      options: {
        stream: true
      }
    }),
    { code: 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR' }
  )

  // Verify model state is in error
  const provider = ai.providers.get('openai')!
  const modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'error')
  assert.equal(modelState!.state.reason, 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR')

  // Wait for restore timeout
  await wait(120)

  // Should be able to make request again after restore
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request after stream timeout restore',
    options: {
      stream: true
    }
  })

  assert.ok(response instanceof ReadableStream)
  assert.equal(requestCount, 2)
})

test('should restore model after provider communication error when enough time has passed', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.request = async (_api: any, _request: any, _context: any) => {
    requestCount++
    if (requestCount === 1) {
      const error: ExtendedError = new Error('Provider communication error')
      error.code = 'PROVIDER_RESPONSE_ERROR'
      throw error
    }
    return {
      choices: [{
        message: {
          content: 'Success after communication error restore'
        }
      }]
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
      model: 'gpt-4o-mini',
      restore: {
        providerCommunicationError: '200ms'
      }
    }]
  })
  await ai.init()

  await setModelState({
    ai,
    provider: 'openai',
    model: 'gpt-4o-mini',
    status: 'error',
    reason: 'PROVIDER_RESPONSE_ERROR'
  })

  // Should not be able to make request initially
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Request with communication error'
    }),
    { code: 'PROVIDER_NO_MODELS_AVAILABLE_ERROR' }
  )

  // Wait for restore timeout
  await wait(200)

  // Should be able to make request again after restore
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request after communication error restore'
  }) as ContentResponse

  assert.equal(response.text, 'Success after communication error restore')
  assert.equal(requestCount, 2)
})

test('should restore model after provider exceeded quota error when enough time has passed', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.request = async (_api: any, _request: any, _context: any) => {
    requestCount++
    return {
      choices: [{
        message: {
          content: 'Success after quota error restore'
        }
      }]
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
      model: 'gpt-4o-mini',
      restore: {
        providerExceededError: '200ms'
      }
    }]
  })
  await ai.init()

  await setModelState({
    ai,
    provider: 'openai',
    model: 'gpt-4o-mini',
    status: 'error',
    reason: 'PROVIDER_EXCEEDED_QUOTA_ERROR'
  })

  // Should not be able to make request initially
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Request with quota error'
    }),
    { code: 'PROVIDER_NO_MODELS_AVAILABLE_ERROR' }
  )

  // Wait for restore timeout
  await wait(200)

  // Should be able to make request again after restore
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request after quota error restore'
  }) as ContentResponse

  assert.equal(response.text, 'Success after quota error restore')
  assert.equal(requestCount, 1)
})

test('should use different restore timeouts for different error types', async () => {
  const client = createDummyClient()
  let requestCount = 0
  client.request = async (_api: any, _request: any, _context: any) => {
    requestCount++
    if (requestCount === 0) {
      const error: ExtendedError = new Error('Rate limit error')
      error.code = 'PROVIDER_RATE_LIMIT_ERROR'
      throw error
    }
    return {
      choices: [{
        message: {
          content: 'Success'
        }
      }]
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
      model: 'gpt-4o-mini',
      limits: {
        rate: {
          max: 1,
          timeWindow: '200ms'
        }
      },
      restore: {
        rateLimit: '100ms',
        timeout: '100ms',
        providerCommunicationError: '300ms',
        providerExceededError: '400ms'
      }
    }]
  })
  await ai.init()

  // Make a request that will have rate limit error
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request'
  })
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Request with rate limit error'
    }),
    { code: 'PROVIDER_RATE_LIMIT_ERROR' }
  )

  // No wait shorter than rateLimit restore time

  // Should not be restored yet
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Request too soon'
    }),
    { code: 'PROVIDER_NO_MODELS_AVAILABLE_ERROR' }
  )

  // Wait for full restore time
  await wait(200)

  // Should be restored now
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request after restore'
  }) as ContentResponse

  assert.equal(response.text, 'Success')
  assert.equal(requestCount, 2)
})

test('should update model state in storage when restoring', async () => {
  const client = createDummyClient()
  client.request = async (_api: any, _request: any, _context: any) => {
    return {
      choices: [{
        message: {
          content: 'Success'
        }
      }]
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
      model: 'gpt-4o-mini',
      restore: {
        rateLimit: '100ms'
      }
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request'
  })

  // Hit rate limit
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Second request'
    }),
    { code: 'PROVIDER_RATE_LIMIT_ERROR' }
  )

  // Verify model state is in error
  const provider = ai.providers.get('openai')!
  let modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'error')
  assert.equal(modelState!.state.reason, 'PROVIDER_RATE_LIMIT_ERROR')

  // Wait for restore timeout
  await wait(120)

  await setModelState({
    ai,
    provider: 'openai',
    model: 'gpt-4o-mini',
    status: 'ready'
  })

  // Make request to trigger restore
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Third request after restore'
  })

  // Verify model state is now ready
  modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'ready')
  assert.equal(modelState!.state.reason, 'NONE')
})

test('should use default restore timeouts when not specified', async () => {
  const client = createDummyClient()
  client.request = async (_api: any, _request: any, _context: any) => {
    return {
      choices: [{
        message: {
          content: 'Success'
        }
      }]
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
      // No restore config specified - should use defaults
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request'
  })

  // Hit rate limit
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Second request'
    }),
    { code: 'PROVIDER_RATE_LIMIT_ERROR' }
  )

  // Verify model settings have default restore values
  const modelSettings = ai.modelSettings['gpt-4o-mini']
  assert.equal(modelSettings.restore.rateLimit, 60000) // 1m default
  assert.equal(modelSettings.restore.timeout, 60000) // 1m default
  assert.equal(modelSettings.restore.providerCommunicationError, 60000) // 1m default
  assert.equal(modelSettings.restore.providerExceededError, 600000) // 10m default
})

test('should not restore model with unknown error reason', async () => {
  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client: createDummyClient()
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini',
      restore: {
        rateLimit: '100ms'
      }
    }]
  })
  await ai.init()

  // Create a model state with unknown error reason
  const modelState = {
    name: 'gpt-4o-mini',
    rateLimit: { count: 0, windowStart: 0 },
    state: {
      status: 'error' as const,
      timestamp: Date.now() - 200, // Old enough to restore
      reason: 'UNKNOWN_ERROR' as any // Unknown error reason
    }
  }

  const modelSettings = ai.modelSettings['gpt-4o-mini']
  const canRestore = ai.restoreModelState(modelState, modelSettings.restore)

  assert.equal(canRestore, false)
})

test('should log debug message when model is not ready during selection', async () => {
  const logs: any[] = []
  const testLogger = pino({ level: 'debug' })

  // Mock the debug method to capture logs
  const originalDebug = testLogger.debug
  const mockDebug = mock.fn((obj?: any, msg?: string, ...args: any[]) => {
    logs.push({ obj, msg, args })
    return originalDebug.call(testLogger, obj, msg, ...args)
  })
  testLogger.debug = mockDebug as any

  const client = createDummyClient()
  client.request = async (_api: any, _request: any, _context: any) => {
    return {
      choices: [{
        message: {
          content: 'Success'
        }
      }]
    }
  }

  const ai = new Ai({
    logger: testLogger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini',
      restore: {
        rateLimit: '1s' // Long restore time
      }
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request'
  })

  // Hit rate limit
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Second request'
    }),
    { code: 'PROVIDER_RATE_LIMIT_ERROR' }
  )

  // Try to make another request immediately (should not restore)
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Third request'
    }),
    { code: 'PROVIDER_NO_MODELS_AVAILABLE_ERROR' }
  )

  // Verify debug log was called
  const debugCalls = mockDebug.mock.calls
  const modelNotReadyLog = debugCalls.find(call =>
    call.arguments[1] && call.arguments[1].includes('is not ready for provider')
  )
  assert.ok(modelNotReadyLog, 'Expected debug log for model not ready')
})
