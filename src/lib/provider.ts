import createError from '@fastify/error'

export type ProviderRequestOptions = {
  context?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  onStreamChunk?: (response: string) => Promise<string>
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
} | ReadableStream

export type StreamChunkCallback = (response: string) => Promise<string>
export const NoContentError = createError<[string]>('NO_CONTENT', '%s didn\'t return any content')
export const InvalidTypeError = createError<string>('DESERIALIZING_ERROR', 'Deserializing error: %s', 500)
