import pino, { type Logger } from 'pino'
import fastify from 'fastify'
import ai, { type AiPluginOptions, type AiChatHistory } from '../../src/index.ts'

export async function createApp ({ client, logger }: { client: any, logger?: Logger }) {
  if (!logger) {
    logger = pino({ level: 'silent' })
  }
  const app = fastify({ loggerInstance: logger as Logger })

  const options = {
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
  }

  await app.register(ai, options as AiPluginOptions)

  app.route({
    url: '/prompt',
    method: 'POST',
    handler: async (request, reply) => {
      const { prompt, context, temperature, history, sessionId, resume } = request.body as { prompt: string, context: string, temperature: number, history: AiChatHistory, sessionId: string, resume: boolean }
      const response = await app.ai.request({
        request,
        prompt,
        context,
        temperature,
        history,
        sessionId,
        resume,
        stream: false
      } as any, reply)

      return reply.send(response)
    }
  })

  app.route({
    url: '/stream',
    method: 'POST',
    handler: async (request, reply) => {
      const { prompt, context, temperature, history, sessionId, resume } = request.body as { prompt: string, context: string, temperature: number, history: AiChatHistory, sessionId: string, resume: boolean }
      const response = await app.ai.request({
        request,
        prompt,
        context,
        temperature,
        history,
        sessionId,
        resume,
        stream: true
      } as any, reply)

      return reply.send(response)
    }
  })

  return app
}

export function createDummyClient () {
  return {
    init: async (_options: any, _context: any) => ({}),
    close: async (_api: any, _context: any) => {},
    request: async (_api: any, _request: any, _context: any) => ({}),
    stream: async (_api: any, _request: any, _context: any) => ({})
  }
}

// Mock the readable stream to emit chunks that will result in 'All good'
export function mockOpenAiStream (chunks: any[]) {
  let chunkIndex = 0

  // Create an async iterable stream
  const asyncIterable = {
    async * [Symbol.asyncIterator] () {
      while (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex++]
        // Send in OpenAI stream format - raw data lines
        const data = `data: ${JSON.stringify(chunk)}\n\n`
        yield Buffer.from(data)

        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      // Send [DONE] to end the stream
      yield Buffer.from('data: [DONE]\n\n')
    }
  }

  return asyncIterable
}

export async function consumeStream (response: ReadableStream) {
  const content: string[] = []
  let end: string = ''

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

      let currentEvent: string | null = null
      let currentData: string | null = null

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim()
        } else if (line.startsWith('data: ')) {
          currentData = line.substring(6).trim()
        } else if (line === '' && currentEvent && currentData) {
          // End of event, parse the data
          try {
            const parsedData = JSON.parse(currentData)
            if (currentEvent === 'content') {
              content.push(parsedData.response)
            } else if (currentEvent === 'end') {
              end = parsedData.response
            }
          } catch {
            // Ignore parsing errors
          }

          // Reset for next event
          currentEvent = null
          currentData = null
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { content, end }
}
