import createError from '@fastify/error'
import type { AiProvider, PlainResponse } from './ai.ts'
import type { AiLimits } from '../plugins/ai.ts'

export type ChatHistory = {
  prompt: string
  response: string
}[]

export type ProviderRequestOptions = {
  context?: string
  history?: ChatHistory
  sessionId?: string | boolean
  temperature?: number
  limits?: AiLimits
  stream?: boolean
  onStreamChunk?: (response: string) => Promise<string>
}

export interface Provider {
  name: AiProvider
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

export type ProviderResponse = PlainResponse | ReadableStream

export type StreamChunkCallback = (response: string) => Promise<string>
export const NoContentError = createError<[string]>('NO_CONTENT', '%s didn\'t return any content')
export const InvalidTypeError = createError<string>('DESERIALIZING_ERROR', 'Deserializing error: %s', 500)
