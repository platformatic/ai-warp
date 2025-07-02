import { ReadableStream, type UnderlyingByteSource, ReadableByteStreamController } from 'node:stream/web'
import { ReadableStream as ReadableStreamPolyfill } from 'web-streams-polyfill'
import { type ChatCompletionChunk } from 'openai/resources/index'
import OpenAI from 'openai'
import type { AiProvider } from '../lib/ai.ts'
import { InvalidTypeError, NoContentError, type ChatHistory, type ProviderClient, type ProviderRequestOptions, type ProviderResponse, type StreamChunkCallback } from '../lib/provider.ts'
import { encodeEvent, type AiStreamEvent } from '../lib/event.ts'
import type { Logger } from 'pino'

// @see https://github.com/openai/openai-node
// @see https://platform.openai.com/docs/api-reference/chat/create

export type OpenAIOptions = {
  logger: Logger
  apiKey: string
  baseURL?: string
}

type OpenAIRequestOptions = ProviderRequestOptions

type Messages = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class OpenAIProvider {
  name: AiProvider = 'openai'
  logger: Logger
  client: ProviderClient

  constructor (options: OpenAIOptions, client?: ProviderClient) {
    // TODO validate options

    this.logger = options.logger

    if (client) {
      // inject client for testing
      this.client = client
    } else {
      this.client = new OpenAI({
        apiKey: options.apiKey,
      // TODO baseURL: options.baseURL
      })
    }
  }

  async request (model: string, prompt: string, options: OpenAIRequestOptions): Promise<ProviderResponse> {
    const messages = options.context ? [{ role: 'system', content: options.context }] : []
    messages.push(...this.chatHistoryToMessages(options.history))
    messages.push({ role: 'user', content: prompt })

    const request = {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: options.stream,
    }

    if (options.stream) {
      const response = await this.client.chat.completions.create(request)
      return new ReadableStream(new OpenAiByteSource(response.toReadableStream() as ReadableStreamPolyfill, options.onStreamChunk))
    }

    const response = await this.client.chat.completions.create(request)

    this.logger.debug({ response }, 'openai full response (no stream)')

    return {
      text: response.choices[0].message.content
    }
  }

  private chatHistoryToMessages (chatHistory?: ChatHistory): Messages[] {
    if (chatHistory === undefined) {
      return []
    }

    const messages: Messages[] = []
    for (const previousInteraction of chatHistory) {
      messages.push({ role: 'user', content: previousInteraction.prompt })
      messages.push({ role: 'assistant', content: previousInteraction.response })
    }

    return messages
  }
}

class OpenAiByteSource implements UnderlyingByteSource {
  type: 'bytes' = 'bytes'
  polyfillStream: ReadableStreamPolyfill
  reader?: ReadableStreamDefaultReader
  chunkCallback?: StreamChunkCallback

  constructor (polyfillStream: ReadableStreamPolyfill, chunkCallback?: StreamChunkCallback) {
    this.polyfillStream = polyfillStream
    this.chunkCallback = chunkCallback
  }

  start (): void {
    this.reader = this.polyfillStream.getReader()
  }

  async pull (controller: ReadableByteStreamController): Promise<void> {
    // start() defines this.reader and is called before this

    const { done, value } = await this.reader!.read()

    if (done !== undefined && done) {
      controller.close()
      return
    }

    if (!(value instanceof Uint8Array)) {
      // This really shouldn't happen but just in case + typescript likes
      const error = new InvalidTypeError('OpenAI stream value not a Uint8Array')

      const eventData: AiStreamEvent = {
        event: 'error',
        data: error
      }
      controller.enqueue(encodeEvent(eventData))
      controller.close()

      return
    }

    const jsonString = Buffer.from(value).toString('utf8')
    const chunk: ChatCompletionChunk = JSON.parse(jsonString)

    if (chunk.choices.length === 0) {
      const error = new NoContentError('OpenAI stream')

      const eventData: AiStreamEvent = {
        event: 'error',
        data: error
      }
      controller.enqueue(encodeEvent(eventData))
      controller.close()

      return
    }

    const { content } = chunk.choices[0].delta

    let response = content ?? ''
    if (this.chunkCallback !== undefined) {
      response = await this.chunkCallback(response)
    }

    const eventData: AiStreamEvent = {
      event: 'content',
      data: {
        response
      }
    }
    controller.enqueue(encodeEvent(eventData))
  }
}
