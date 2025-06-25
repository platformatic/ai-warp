// provider interface

export interface Provider {
  request: (model: string, prompt: string) => Promise<ProviderResponse>
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

export type Response = {
  text: string
}
