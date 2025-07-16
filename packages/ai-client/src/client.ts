import type { AIClient, AskOptions, ClientOptions, StreamMessage, AskResponse, Logger } from './types.ts'
import type { AiModel } from '@platformatic/ai-provider'
import { pipeline } from 'node:stream/promises'
import { Transform, Readable } from 'node:stream'
import split2 from 'split2'

// @ts-ignore
import abstractLogging from 'abstract-logging'

export class Client implements AIClient {
  private url: string
  private headers: Record<string, string>
  private timeout: number
  private logger: Logger

  constructor (options: ClientOptions) {
    this.url = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    this.timeout = options.timeout ?? 60000
    this.logger = options.logger ?? abstractLogging
  }

  private normalizeModels (models?: (string | AiModel)[]): AiModel[] | undefined {
    if (!models || models.length === 0) {
      return undefined
    }

    return models.map(model => {
      if (typeof model === 'string') {
        const parts = model.split(':')
        if (parts.length === 2) {
          return {
            provider: parts[0] as any,
            model: parts[1]
          }
        }
        throw new Error(`Invalid models format: ${model}. Expected format: "provider:model"`)
      }
      return model
    })
  }

  async ask (options: AskOptions): Promise<Readable> {
    const endpoint = `${this.url}/ai`
    const normalizedModels = this.normalizeModels(options.models)

    this.logger.debug('Making AI request', { endpoint, prompt: options.prompt, sessionId: options.sessionId, models: normalizedModels })

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          prompt: options.prompt,
          sessionId: options.sessionId,
          context: options.context,
          temperature: options.temperature,
          models: normalizedModels,
          history: options.history,
          stream: options.stream !== false
        }),
        signal: AbortSignal.timeout(this.timeout)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        this.logger.error('AI request failed', { status: response.status, statusText: response.statusText, body: errorBody })
        throw new Error(`HTTP ${response.status}: ${errorBody}`)
      }

      this.logger.info('AI request successful', { status: response.status })

      if (!response.body) {
        throw new Error('Response body is null')
      }

      return this.createStreamFromResponse(response.body)
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

  private createStreamFromResponse (body: ReadableStream<Uint8Array>): Transform {
    const logger = this.logger

    const parseAIMessages = new Transform({
      objectMode: true,
      transform (chunk: string, _encoding, callback) {
        if (chunk.trim()) {
          const event = parseEvent(chunk)
          if (event) {
            const message = convertEventToMessage(event)
            if (message) {
              this.push(message)
            }
          }
        }
        callback()
      }
    })

    const nodeReadable = Readable.fromWeb(body)

    pipeline(nodeReadable, split2('\n\n'), parseAIMessages).catch((error) => {
      logger.error({ error: error.message, stack: error.stack }, 'Error in AI message parsing pipeline')
      parseAIMessages.emit('error', error)
    })
    return parseAIMessages
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
      if (typeof data.response === 'object' && (data.response.model || data.response.usage || data.response.sessionId)) {
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
