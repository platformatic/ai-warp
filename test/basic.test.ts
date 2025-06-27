import { test, mock } from 'node:test'
import assert from 'node:assert'
import { Ai } from '../src/lib/ai.ts'
import { ReadableStream as ReadableStreamPolyfill } from 'web-streams-polyfill'

const apiKey = 'test'

test('should be able to perform a basic prompt', async () => {
  const client = {
    chat: {
      completions: {
        create: async () => {
          return {
            choices: [{
              message: {
                content: 'All good'
              }
            }]
          }
        }
      }
    }
  }

  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?'
  })

  assert.equal((response as { text: string }).text, 'All good')
})

test('should be able to perform a prompt with options', async () => {
  const client = {
    chat: {
      completions: {
        create: mock.fn(async () => {
          return {
            choices: [{
              message: {
                content: 'All good'
              }
            }]
          }
        })
      }
    }
  }

  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      maxTokens: 1000,
    }
  })

  assert.deepEqual(client.chat.completions.create.mock.calls[0].arguments, [{
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ],
    temperature: 0.5,
    max_tokens: 1000,
    stream: undefined,
  }])
  assert.equal((response as { text: string }).text, 'All good')
})

test('should be able to perform a prompt with stream', async () => {
  const client = {
    chat: {
      completions: {
        create: mock.fn(async () => {
          return {
            toReadableStream: () => {
              // Mock the readable stream to emit chunks that will result in 'All good'
              const chunks = [
                { choices: [{ delta: { content: 'All' } }] },
                { choices: [{ delta: { content: ' good' } }] }
              ]

              let chunkIndex = 0

              return new ReadableStreamPolyfill({
                start (controller) {
                  // Emit the chunks
                  const sendChunk = () => {
                    if (chunkIndex < chunks.length) {
                      const chunk = chunks[chunkIndex++]
                      const jsonString = JSON.stringify(chunk)
                      const uint8Array = new TextEncoder().encode(jsonString)
                      controller.enqueue(uint8Array)
                      // Send next chunk after a short delay to simulate streaming
                      setTimeout(sendChunk, 10)
                    } else {
                      controller.close()
                    }
                  }
                  sendChunk()
                }
              })
            }
          }
        })
      }
    }
  }

  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      stream: true,
    }
  })

  assert.deepEqual(client.chat.completions.create.mock.calls[0].arguments, [{
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ],
    max_tokens: undefined,
    temperature: undefined,
    stream: true,
  }])

  const chunks: string[] = []

  // The response is a ReadableStream that emits Server-sent events
  const reader = (response as ReadableStream).getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const eventData = decoder.decode(value)
      // Parse Server-sent events format
      const lines = eventData.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.substring(6))
          if (data.response) {
            chunks.push(data.response)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  assert.equal(chunks.join(''), 'All good')
})

// session id, multiple concurrent prompts
