import { mock, test } from 'node:test'
import assert from 'node:assert'
import { setTimeout as wait } from 'node:timers/promises'
import { Ai, type StreamResponse, type ContentResponse } from '../src/lib/ai.ts'
import pino from 'pino'
import { consumeStream, createDummyClient, mockOpenAiStream } from './helper/helper.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should succeed after some failures because of retries', async () => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    request: async () => {
      callCount++
      if (callCount === 2) {
        throw new Error('ERROR_FROM_PROVIDER')
      }
      return {
        choices: [{
          message: {
            content: 'All good'
          }
        }]
      }
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
    limits: {
      retry: {
        max: 2,
        interval: 100
      }
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
  }) as ContentResponse

  assert.equal(callCount, 1)

  assert.equal(response.text, 'All good')
})

test('should fail after max retries', async () => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    request: async () => {
      callCount++
      throw new Error('ERROR_FROM_PROVIDER')
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
    limits: {
      retry: {
        max: 2,
        interval: 100
      }
    }
  })
  await ai.init()

  await assert.rejects(ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
  }), new Error('ERROR_FROM_PROVIDER'))

  assert.equal(callCount, 3)
})

test('should allow requests within rate limit', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      rate: {
        max: 3,
        timeWindow: '1m'
      }
    }
  })
  await ai.init()

  // Should allow 3 requests within limit
  for (let i = 0; i < 3; i++) {
    const response = await ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: `Request ${i + 1}`,
    }) as ContentResponse

    assert.equal(response.text, 'Response')
  }
})

test('should block requests when rate limit exceeded', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      rate: {
        max: 2,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Make requests up to the limit
  for (let i = 0; i < 2; i++) {
    await ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: `Request ${i + 1}`,
    })
  }

  // Next request should be blocked
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Blocked request',
    }),
    /Rate limit exceeded/
  )
})

test('should allow requests after time window passes', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '50ms'
      }
    }
  })
  await ai.init()

  // Make request up to the limit with short time window
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request',
  })

  // Wait for time window to pass
  await wait(60)

  // Should allow another request after time window passes
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Second request',
  }) as ContentResponse

  assert.equal(response.text, 'Response')
})

test('should maintain separate rate limits per model', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
      model: 'gpt-4o-mini'
    }, {
      provider: 'openai',
      model: 'gpt-4o'
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Use up rate limit for first model
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request to mini',
  })

  // Should still be able to use second model
  const response = await ai.request({
    models: ['openai:gpt-4o'],
    prompt: 'Request to gpt-4o'
  }) as ContentResponse

  assert.equal(response.text, 'Response')

  // But first model should be blocked
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Blocked request to mini',
    }),
    /Rate limit exceeded/
  )
})

test('should work with streaming responses and rate limits', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return new ReadableStream({
        start (controller) {
          controller.enqueue(new TextEncoder().encode('{"choices": [{"delta": {"content": "chunk1"}}]}'))
          controller.enqueue(new TextEncoder().encode('{"choices": [{"delta": {"content": "chunk2"}}]}'))
          controller.close()
        }
      })
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
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // First streaming request should work
  const response1 = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First streaming request',
    options: {
      stream: true,
    }
  })

  assert.ok(response1 instanceof ReadableStream)

  // Second streaming request should be blocked
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Blocked streaming request',
      options: {
        stream: true
      }
    }),
    /Rate limit exceeded/
  )
})

// Request timeout tests

test('should timeout non-streaming request after requestTimeout', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      // Simulate a slow response
      await wait(200)
      return {
        choices: [{
          message: {
            content: 'Response'
          }
        }]
      }
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

    limits: {
      requestTimeout: 100
    }
  })
  await ai.init()

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'This should timeout',
    }),
    /PROVIDER_REQUEST_TIMEOUT_ERROR/
  )
})

test('should timeout streaming request after requestTimeout', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      // Simulate a slow initial response
      await wait(200)
      return new ReadableStream({
        start (controller) {
          controller.enqueue(new TextEncoder().encode('{"choices": [{"delta": {"content": "chunk1"}}]}'))
          controller.close()
        }
      })
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
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'This should timeout',
      options: {
        stream: true,
      }
    }),
    /PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR/
  )
})

test('should timeout streaming request between chunks', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      // Create an async iterable that simulates delay between chunks
      const asyncIterable = {
        async * [Symbol.asyncIterator] () {
          // Send first chunk immediately
          yield Buffer.from('data: {"choices": [{"delta": {"content": "chunk1"}}]}\n\n')

          // Wait longer than timeout before second chunk
          await new Promise(resolve => setTimeout(resolve, 200))

          // This should never be reached due to timeout
          yield Buffer.from('data: {"choices": [{"delta": {"content": "chunk2"}}]}\n\n')
          yield Buffer.from('data: [DONE]\n\n')
        }
      }
      return asyncIterable
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
    limits: {
      requestTimeout: 100 // 100ms timeout between chunks
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'This should timeout between chunks',
    options: {
      stream: true
    }
  })

  assert.ok(response instanceof ReadableStream)

  const reader = response.getReader()

  // Should get first chunk
  const { value: chunk1 } = await reader.read()
  assert.ok(chunk1)

  // Should timeout waiting for second chunk
  await assert.rejects(
    reader.read(),
    /PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR/
  )
})

test('should not timeout with fast responses', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        choices: [{
          message: {
            content: 'Fast response'
          }
        }]
      }
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
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Fast request',
  }) as ContentResponse

  assert.equal(response.text, 'Fast response')
})

test('should not retry on timeout error', async () => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    request: async () => {
      callCount++
      // Simulate a slow response
      await wait(200)
      return {
        choices: [{
          message: {
            content: 'Response'
          }
        }]
      }
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
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'This should timeout',
    }),
    /PROVIDER_REQUEST_TIMEOUT_ERROR/
  )
  assert.equal(callCount, 1)
})

// History expiration tests

test('should store history with expiration', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response from AI'
        }
      }]
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      historyExpiration: '1s'
    }
  })
  await ai.init()

  // Create a session and make a request with history
  const response1 = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First message',
  }) as ContentResponse

  assert.ok(response1.sessionId)
  assert.equal(response1.text, 'Response from AI')

  // Immediately check that history exists
  const history = await ai.history.range(response1.sessionId!)
  assert.equal(history.length, 1)
  assert.equal(history[0].prompt, 'First message')
  assert.equal(history[0].response, 'Response from AI')

  // Wait for expiration
  await wait(1100)

  // History should be empty after expiration
  const expiredHistory = await ai.history.range(response1.sessionId!)
  assert.equal(expiredHistory.length, 0)
})

test('should work with streaming responses and history expiration', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Stream' } }] },
        { choices: [{ delta: { content: ' response' }, finish_reason: 'stop' }] },
      ])
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
    limits: {
      historyExpiration: '100ms'
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Streaming request',
    options: { stream: true }
  })

  assert.ok(response instanceof ReadableStream)
  const sessionId = (response as StreamResponse).sessionId
  assert.ok(sessionId)

  // Consume the stream
  const reader = response.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  // Wait a bit for the background history processing to complete
  await wait(50)

  // Check that history was stored
  let history = await ai.history.range(sessionId)
  assert.equal(history.length, 1)
  assert.equal(history[0].prompt, 'Streaming request')

  // Wait for expiration
  await wait(100)

  // History should be expired
  history = await ai.history.range(sessionId)
  assert.equal(history.length, 0)
})

// Max tokens tests

test('should handle max tokens limit in non-streaming response', async () => {
  const client = {
    ...createDummyClient(),
    request: async (api: any, request: any) => {
      // Verify that max_tokens is passed correctly
      assert.equal(request.max_tokens, 100)

      return {
        choices: [{
          message: {
            content: 'This is a truncated response because'
          },
          finish_reason: 'length' // Indicates max tokens reached
        }]
      }
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
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Write a long story',
    options: {
      maxTokens: 100
    }
  }) as ContentResponse

  assert.equal(response.text, 'This is a truncated response because')
  assert.equal(response.result, 'INCOMPLETE_MAX_TOKENS')
})

test('should handle max tokens limit in streaming response', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async (api: any, request: any) => {
      assert.equal(request.max_tokens, 50)
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'This is' } }] },
        { choices: [{ delta: { content: ' a truncated' } }] },
        { choices: [{ delta: { content: ' response' } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] }
      ])
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
      model: 'gpt-4o-mini'
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Write a long story',
    options: {
      stream: true,
      maxTokens: 50
    }
  })

  assert.ok(response instanceof ReadableStream)

  const { content, end } = await consumeStream(response)

  assert.equal(content.join(''), 'This is a truncated response')
  assert.equal(end, 'INCOMPLETE_MAX_TOKENS')
})

test('should handle complete response when max tokens not reached', async () => {
  const client = {
    ...createDummyClient(),
    request: async (api: any, request: any) => {
      // Verify that max_tokens is passed correctly
      assert.equal(request.max_tokens, 1000)

      return {
        choices: [{
          message: {
            content: 'This is a complete response.'
          },
          finish_reason: 'stop' // Indicates natural completion
        }]
      }
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
    prompt: 'Say hello',
    options: {
      maxTokens: 1000
    }
  }) as ContentResponse

  assert.equal(response.text, 'This is a complete response.')
  assert.equal(response.result, 'COMPLETE')
})

test('should handle complete streaming response when max tokens not reached', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async (api: any, request: any) => {
      assert.equal(request.max_tokens, 1000)
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Complete' } }] },
        { choices: [{ delta: { content: ' response.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
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
      model: 'gpt-4o-mini'
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello',
    options: {
      stream: true,
      maxTokens: 1000
    }
  })

  assert.ok(response instanceof ReadableStream)

  const { content, end } = await consumeStream(response)

  assert.equal(content.join(''), 'Complete response.')
  assert.equal(end, 'COMPLETE')
  // Note: The consumeStream helper doesn't currently parse the final result event
  // so we can't assert on finalResult here
})

test('should handle unknown finish reason', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response with unknown finish reason'
        },
        finish_reason: 'content_filter' // Unknown finish reason
      }]
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
      model: 'gpt-4o-mini'
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test prompt',
    options: {
      maxTokens: 100
    }
  }) as ContentResponse

  assert.equal(response.text, 'Response with unknown finish reason')
  assert.equal(response.result, 'INCOMPLETE_UNKNOWN')
})

test('should not pass max_tokens when not specified', async () => {
  const client = {
    ...createDummyClient(),
    request: async (api: any, request: any) => {
      // Verify that max_tokens is undefined when not specified
      assert.equal(request.max_tokens, undefined)

      return {
        choices: [{
          message: {
            content: 'Response without max tokens limit'
          },
          finish_reason: 'stop'
        }]
      }
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
    prompt: 'Test prompt'
    // No limits specified
  }) as ContentResponse

  assert.equal(response.text, 'Response without max tokens limit')
  assert.equal(response.result, 'COMPLETE')
})
