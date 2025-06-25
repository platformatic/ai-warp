import OpenAI from 'openai'
import type { AiProvider } from '../lib/ai.ts'
import type { ProviderClient, ProviderRequestOptions, ProviderResponse } from '../lib/provider.ts'

// @see https://github.com/openai/openai-node

export type OpenAIOptions = {
  // TODO logger
  apiKey: string
  baseURL?: string
}

type OpenAIRequestOptions = ProviderRequestOptions

// TODO implements Provider interface
export class OpenAIProvider {
  name: AiProvider = 'openai'

  client: ProviderClient

  constructor (options: OpenAIOptions, client?: ProviderClient) {
    if (client) {
      // for testing
      this.client = client
    } else {
      this.client = new OpenAI({
        apiKey: options.apiKey,
      // TODO baseURL: options.baseURL
      })
    }
  }

  async request (model: string, prompt: string, options: OpenAIRequestOptions): Promise<ProviderResponse> {
    const input = options.context
      ? [
          {
            role: 'system',
            content: options.context
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      : prompt

    const response = await this.client.responses.create({
      model,
      input,
      temperature: options.temperature,
      // TODO filter in o-series models https://platform.openai.com/docs/api-reference/chat/create#chat-create-max_tokens
      max_output_tokens: options.maxTokens,
      stream: options.stream,
    })

    // logger.debug console.dir(response, { depth: null })

    // TODO if stream

    return {
      text: response.output_text
    }
  }
}
