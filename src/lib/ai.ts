import { OpenAIProvider } from '../providers/openai.ts'

// supported providers
export type AiProvider = 'openai'

export type Model = {
  provider: AiProvider
  model: string
}

export type ProviderState = {
  // TODO
}

type QueryModel = string | Model

export type Query = {
  models: QueryModel[]

  prompt: string
}

export type Response = {
  text: string
}

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

export interface Provider {
  request: (request: QueryRequest) => Promise<Response>
}

export type QueryProvider = {
  provider: Provider
  model: string
}

export type QueryRequest = {
  model: string
  query: Query
}

export interface ProviderClient {
  responses: {
    create: (request: any) => Promise<any>
  }
}

export type ProviderResponse = {
  // TODO
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

  select (models: QueryModel[]): QueryProvider | undefined {
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

  async request (query: Query): Promise<Response> {
    // TODO validate query models

    const p = this.select(query.models)

    if (!p) {
      throw new Error(`Provider not found for model: ${query.models[0]}`)
    }

    const response: ProviderResponse = await p.provider.request({ query, model: p.model })

    // TODO update state

    return response
  }
}
