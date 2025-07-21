import { Pool } from 'undici'
import { Readable } from 'node:stream'
import type { AiProvider, AiResponseResult } from '../lib/ai.ts'
import { type AiChatHistory, type ProviderClient, type ProviderClientContext, type ProviderClientOptions, type ProviderOptions, type ProviderRequestOptions, type ProviderResponse, type StreamChunkCallback } from '../lib/provider.ts'
import { encodeEvent, parseEventStream, type AiStreamEvent } from '../lib/event.ts'
import { ProviderResponseNoContentError } from '../lib/errors.ts'
import { BaseProvider } from './lib/base.ts'
import { DEFAULT_UNDICI_POOL_OPTIONS, OPENAI_DEFAULT_API_PATH, OPENAI_DEFAULT_BASE_URL, OPENAI_PROVIDER_NAME, UNDICI_USER_AGENT } from '../lib/config.ts'
import { createOpenAiClient } from './lib/openai-undici-client.ts'

// @see https://github.com/openai/openai-node
// @see https://platform.openai.com/docs/api-reference/chat/create

export type OpenAIOptions = ProviderOptions
export type OpenAIResponse = any // TODO fix types

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAIRequest = {
  model: string
  messages: OpenAIMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

export type OpenAiClientOptions = ProviderClientOptions & {
  baseUrl: string
  apiPath: string
  apiKey: string
  userAgent: string
  providerName: string
  undiciOptions?: Pool.Options

  checkResponseFn?: (response: any, context: ProviderClientContext, providerName: string) => Promise<void>
}

export class OpenAIProvider extends BaseProvider {
  name: AiProvider = 'openai'
  providerName: string = OPENAI_PROVIDER_NAME

  constructor (options: OpenAIOptions, client?: ProviderClient) {
    super(options, client ?? createOpenAiClient({
      providerName: OPENAI_PROVIDER_NAME,
      baseUrl: options.clientOptions?.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
      apiPath: options.clientOptions?.apiPath ?? OPENAI_DEFAULT_API_PATH,
      apiKey: options.clientOptions?.apiKey ?? '',
      userAgent: options.clientOptions?.userAgent ?? UNDICI_USER_AGENT,
      undiciOptions: options.clientOptions?.undiciOptions ?? DEFAULT_UNDICI_POOL_OPTIONS,
    }))
  }

  async request (model: string, prompt: string, options: ProviderRequestOptions): Promise<ProviderResponse> {
    const messages: OpenAIMessage[] = options.context ? [{ role: 'system', content: options.context }] : []
    messages.push(...this.chatHistoryToMessages(options.history))
    messages.push({ role: 'user', content: prompt })

    const request: OpenAIRequest = {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: options.stream,
    }

    if (options.stream) {
      const response = await this.client.stream(this.api, request, this.context)

      return new OpenAiStreamTransformer(this.providerName, response, options.onStreamChunk)
    }

    this.logger.debug({ request }, `${this.providerName} request`)
    const response = await this.client.request(this.api, request, this.context)

    this.logger.debug({ response }, `${this.providerName} full response (no stream)`)

    const text = response.choices?.[0]?.message?.content
    if (!text) {
      throw new ProviderResponseNoContentError(this.providerName)
    }

    return {
      text,
      result: mapResponseResult(response.choices?.[0]?.finish_reason)
    }
  }

  private chatHistoryToMessages (chatHistory?: AiChatHistory): OpenAIMessage[] {
    if (chatHistory === undefined) {
      return []
    }

    const messages: OpenAIMessage[] = []
    for (const previousInteraction of chatHistory) {
      messages.push({ role: 'user', content: previousInteraction.prompt })
      messages.push({ role: 'assistant', content: previousInteraction.response })
    }

    return messages
  }
}

class OpenAiStreamTransformer extends Readable {
  providerName: string
  sourceStream: Readable
  chunkCallback?: StreamChunkCallback

  constructor (providerName: string, sourceStream: Readable, chunkCallback?: StreamChunkCallback) {
    super()
    this.providerName = providerName
    this.sourceStream = sourceStream
    this.chunkCallback = chunkCallback

    this.sourceStream.on('data', this.handleData.bind(this))
    this.sourceStream.on('end', this.handleEnd.bind(this))
    this.sourceStream.on('error', this.handleError.bind(this))
  }

  private async handleData(chunk: Buffer) {
    const events = parseEventStream(chunk.toString('utf8'))
    for (const event of events) {
      if (event.event === 'error') {
        const error = new ProviderResponseNoContentError(`${this.providerName} stream`)

        const eventData: AiStreamEvent = {
          event: 'error',
          data: error
        }
        this.push(encodeEvent(eventData))
        this.push(null)
        return
      }

      // data only events
      if (!event.event && event.data) {
        if (event.data === '[DONE]') {
          this.push(null)
          return
        }

        const data = JSON.parse(event.data)
        const { content } = data.choices[0].delta
        let response = content ?? ''
        if (this.chunkCallback) {
          response = await this.chunkCallback(response)
        }

        const eventData: AiStreamEvent = {
          event: 'content',
          data: { response }
        }
        this.push(encodeEvent(eventData))

        const finish = data.choices[0].finish_reason
        if (finish) {
          const eventData: AiStreamEvent = {
            event: 'end',
            data: { response: mapResponseResult(finish) }
          }
          this.push(encodeEvent(eventData))
          this.push(null)
          return
        }
      }
    }
  }

  private handleEnd() {
    this.push(null)
  }

  private handleError(error: Error) {
    this.destroy(error)
  }

  _read() {
    // No-op: data is pushed from source stream events
  }
}

function mapResponseResult (result: string | undefined): AiResponseResult {
  // response is complete
  if (result === 'stop') {
    return 'COMPLETE'
  }
  // when the response is truncated because of maxTokens
  if (result === 'length') {
    return 'INCOMPLETE_MAX_TOKENS'
  }
  return 'INCOMPLETE_UNKNOWN'
}
