import OpenAI from 'openai'
import type { AiProvider } from '../lib/ai.ts'
import type { ProviderClient, ProviderResponse } from '../lib/provider.ts'

// @see https://github.com/openai/openai-node

export type OpenAIOptions = {
  // TODO logger
  apiKey: string
  baseURL?: string
}

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

  async request (model: string, prompt: string): Promise<ProviderResponse> {
    // TODO
    const response = await this.client.responses.create({
      model,
      input: prompt,

      // instructions, roles ...

      // TODO temperature, maxTokens, stream ...
    })

    // logger.debug console.dir(response, { depth: null })

    return {
      text: response.output_text
    }
  }
}
