import type { AskOptions, ClientOptions, StreamMessage, AskResponse, Logger, AskResponseStream, AskResponseContent } from './types.ts'
import { consoleLogger } from './console-logger.ts'

const DEFAULT_PROMPT_PATH = '/api/v1/prompt'
const DEFAULT_STREAM_PATH = '/api/v1/stream'
const DEFAULT_TIMEOUT = 60_000

export class Client {
  private url: string
  private headers: Record<string, string>
  private timeout: number
  private logger: Logger
  private promptPath: string
  private streamPath: string

  constructor (options: ClientOptions) {
    this.url = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.logger = options.logger ?? consoleLogger
    this.promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH
    this.streamPath = options.streamPath ?? DEFAULT_STREAM_PATH
  }

  async ask (options: AskOptions & { stream: true }): Promise<AskResponseStream>
  async ask (options: AskOptions & { stream?: false }): Promise<AskResponseContent>
  async ask (options: AskOptions): Promise<AskResponseStream | AskResponseContent> {
    const isStreaming = options.stream !== false
    const endpoint = this.url + (isStreaming ? this.streamPath : this.promptPath)

    this.logger.debug('Making AI request', { endpoint, prompt: options.prompt, sessionId: options.sessionId, models: options.models, stream: isStreaming })

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          Accept: isStreaming ? 'text/event-stream' : 'application/json'
        },
        body: JSON.stringify({
          prompt: options.prompt,
          sessionId: options.sessionId,
          context: options.context,
          temperature: options.temperature,
          models: options.models,
          history: options.history,
          stream: isStreaming
        }),
        signal: AbortSignal.timeout(this.timeout)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        this.logger.error('AI request failed', { status: response.status, statusText: response.statusText, body: errorBody })
        throw new Error(`HTTP ${response.status}: ${errorBody}`)
      }

      this.logger.info('AI request successful', { status: response.status })

      if (isStreaming) {
        if (!response.body) {
          throw new Error('Response body is null')
        }
        const webStream = this.createStreamFromResponse(response.body)
        return {
          stream: this.createAsyncIterableStream(webStream),
          headers: response.headers
        }
      } else {
        return {
          content: await response.json() as JSON,
          headers: response.headers
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'TimeoutError') {
          this.logger.warn('AI request timed out', { timeout: this.timeout })
          throw new Error('Request timeout')
        }
        this.logger.error('AI request error', { error: error.message, stack: error.stack })
        throw error
      }
      this.logger.error('Unknown AI request error', { error })
      throw new Error('Unknown error occurred')
    }
  }

  private createStreamFromResponse (body: ReadableStream<Uint8Array>): ReadableStream<StreamMessage> {
    let buffer = ''

    return body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, StreamMessage>({
          transform (chunk, controller) {
            buffer += chunk

            const events = buffer.split('\n\n')
            buffer = events.pop() || ''

            for (const eventText of events) {
              if (eventText.trim()) {
                const event = parseEvent(eventText)
                if (event) {
                  const message = convertEventToMessage(event)
                  if (message) {
                    controller.enqueue(message)
                  }
                }
              }
            }
          },
          flush (controller) {
            if (buffer.trim()) {
              const event = parseEvent(buffer)
              if (event) {
                const message = convertEventToMessage(event)
                if (message) {
                  controller.enqueue(message)
                }
              }
            }
          }
        })
      )
  }

  private createAsyncIterableStream (stream: ReadableStream<StreamMessage>) {
    const reader = stream.getReader()

    return {
      async * [Symbol.asyncIterator] () {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) yield value
          }
        } finally {
          reader.releaseLock()
        }
      }
    }
  }
}

interface ParsedEvent {
  event?: string
  data?: string
}

function parseEvent (eventText: string): ParsedEvent | null {
  const lines = eventText.split('\n')
  const event: ParsedEvent = {}

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event.event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      event.data = line.slice(6).trim()
    }
  }

  return (event.event || event.data) ? event : null
}

function convertEventToMessage (event: ParsedEvent): StreamMessage | null {
  if (!event.data) {
    return null
  }

  let data: any
  let isPlainText = false

  try {
    data = JSON.parse(event.data)
  } catch {
    isPlainText = true
    data = event.data.trim()
  }

  if (isPlainText) {
    return {
      type: 'content',
      content: data
    }
  }

  if (event.event) {
    switch (event.event) {
      case 'content':
        return {
          type: 'content',
          content: data.response || ''
        }

      case 'end':
        return {
          type: 'done',
          response: data.response as AskResponse
        }

      case 'error':
        return {
          type: 'error',
          error: new Error(data.message || 'Unknown error')
        }

      default:
        return null
    }
  } else {
    if (data.error || data.message) {
      return {
        type: 'error',
        error: new Error(data.error || data.message || 'Unknown error')
      }
    } else if (data.response) {
      if (typeof data.response === 'object' && (data.response.model || data.response.sessionId)) {
        return {
          type: 'done',
          response: data.response as AskResponse
        }
      } else {
        return {
          type: 'content',
          content: typeof data.response === 'string' ? data.response : data.response.content || ''
        }
      }
    } else if (data.content) {
      return {
        type: 'content',
        content: data.content
      }
    }
    return null
  }
}
