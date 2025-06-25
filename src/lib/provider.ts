export type ProviderRequestOptions = {
  context?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
}

export interface Provider {
  request: (model: string, prompt: string, options: ProviderRequestOptions) => Promise<ProviderResponse>
}

export interface ProviderClient {
  // OpenAI client
  chat: {
    completions: {
      create: (request: any) => Promise<any>
    }
  }
}

export type ProviderResponse = {
  // TODO
  text: string,
  // TODO id
}
