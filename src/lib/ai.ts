import { OpenAIProvider } from '../providers/openai.ts'
import type { Provider, ProviderClient } from './provider.ts'

// supported providers
export type AiProvider = 'openai'

export type Model = {
  provider: AiProvider
  model: string
}

type QueryModel = string | Model

export type AiOptions = {
  providers: Record<AiProvider, ProviderOptions>
}

export type ProviderOptions = {
  apiKey: string,
  models: ModelOptions[]
  client?: ProviderClient
}

export type ModelOptions = {
  name: string
}

export type ModelProvider = {
  provider: Provider
  model: string
}

export type Request = {
  models: QueryModel[]

  prompt: string
}

export type Response = {
  text: string
}

export class Ai {
  providers: Map<string, Provider>

  constructor (options: AiOptions) {
    // TODO options, validate options

    this.providers = new Map()

    for (const provider of Object.keys(options.providers)) {
      const p = provider as AiProvider
      for (const model of options.providers[p].models) {
        // TODO nest by provider/model
        if (options.providers[p].client) {
          this.providers.set(`${p}:${model.name}`, new OpenAIProvider(options.providers[p], options.providers[p].client))
        } else {
          this.providers.set(`${p}:${model.name}`, new OpenAIProvider(options.providers[p]))
        }
      }
    }
  }

  select (models: QueryModel[]): ModelProvider | undefined {
    let provider: Provider | undefined
    let model = models[0]

    if (typeof model === 'string') {
      provider = this.providers.get(model)
    } else {
      provider = this.providers.get(`${model.provider}:${model.model}`)
      model = model.model
    }

    return provider ? { provider, model } : undefined
  }

  async request (request: Request): Promise<Response> {
    // TODO validate query models

    const p = this.select(request.models)

    if (!p) {
      throw new Error(`Provider not found for model: ${request.models[0]}`)
    }

    const response = await p.provider.request(p.model, request.prompt)

    // TODO update state

    // TODO map provider response to response

    return response
  }
}
