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
    // TODO history

    const messages = options.context
      ? [
          { role: 'system', content: options.context },
          { role: 'user', content: prompt }
        ]
      : [{ role: 'user', content: prompt }]

    const response = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: options.stream,
    })

    // logger.debug response
    // console.dir(response, { depth: null })

    // TODO if stream

    return {
      text: response.choices[0].message.content
    }
  }
}
