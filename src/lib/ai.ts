import { OpenAIProvider } from '../providers/openai.ts'
import type { Provider, ProviderClient, ProviderRequestOptions } from './provider.ts'

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
  models?: ModelOptions[]
  client?: ProviderClient
}

export type ModelOptions = {
  name: string
} | string

export type AddModelsOptions = {
  provider: AiProvider
  model: ModelOptions
}

export type ModelProvider = {
  provider: ProviderState
  model: ModelState
}

export type Request = {
  models: QueryModel[]

  prompt: string
  options?: ProviderRequestOptions
}

export type Response = {
  text: string
}

export type ProviderState = {
  provider: Provider
  models: Map<string, ModelState>
}

export type ModelState = {
  name: string
}

export class Ai {
  providers: Map<AiProvider, ProviderState>

  constructor (options: AiOptions) {
    // TODO validate options

    this.providers = new Map()

    for (const provider of Object.keys(options.providers)) {
      const p = provider as AiProvider

      const providerState = {
        provider: new OpenAIProvider(options.providers[p], options.providers[p].client),
        models: new Map()
      }

      if (options.providers[p].models) {
        for (const model of options.providers[p].models) {
          if (typeof model === 'string') {
            providerState.models.set(model, { name: model })
          } else {
            providerState.models.set(model.name, { name: model.name })
          }
        }
      }

      this.providers.set(p, providerState)
    }
  }

  addModels (models: AddModelsOptions[]) {
    for (const model of models) {
      const providerState = this.providers.get(model.provider)
      if (providerState) {
        if (typeof model.model === 'string') {
          providerState.models.set(model.model, { name: model.model })
        } else {
          providerState.models.set(model.model.name, { name: model.model.name })
        }
      }
    }
  }

  select (models: QueryModel[]): ModelProvider | undefined {
    let provider: ProviderState | undefined
    let model: ModelState | undefined
    // TODO selection
    const modelName = models[0]

    if (typeof modelName === 'string') {
      const [providerName, m] = modelName.split(':')
      provider = this.providers.get(providerName as AiProvider)
      model = provider?.models.get(m)
    } else {
      provider = this.providers.get(modelName.provider)
      model = provider?.models.get(modelName.model)
    }

    return provider && model
      ? { provider, model }
      : undefined
  }

  async request (request: Request): Promise<Response> {
    // TODO validate query models

    const p = this.select(request.models)

    if (!p) {
      throw new Error(`Provider not found for model: ${request.models[0]}`)
    }

    const options = {
      context: request.options?.context,
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
      stream: request.options?.stream,
    }

    const response = await p.provider.provider.request(p.model.name, request.prompt, options)

    // TODO update state

    // TODO map provider response to response

    return response
  }
}
