import type { Logger } from 'pino'
import type { AiProvider, AiResponseResult } from './ai.ts'

export type AiChatHistory = {
  prompt: string
  response: string
}[]

export type AiSessionId = string

export type ProviderRequestOptions = {
  context?: string
  history?: AiChatHistory
  sessionId?: AiSessionId
  temperature?: number
  stream?: boolean
  onStreamChunk?: (response: string) => Promise<string>
  maxTokens?: number
}

export interface Provider {
  name: AiProvider
  request: (model: string, prompt: string, options: ProviderRequestOptions) => Promise<ProviderResponse>
}

export interface ProviderOptions {
  logger: Logger
  client?: ProviderClient
  clientOptions?: ProviderClientOptions
}

export interface ProviderClientOptions {
  apiKey: string
  baseUrl?: string
}

export type ProviderClientContext = {
  logger: Logger
}

export type ProviderClientRequest = {
  model: string
  prompt: string
  options: ProviderRequestOptions
}

export type ProviderContentResponse = {
  text: string
  result: AiResponseResult
}

export interface ProviderClient {
  init: (options: ProviderClientOptions | undefined, context: ProviderClientContext) => Promise<any>
  close: (api: any, context: ProviderClientContext) => Promise<void>
  request: (api: any, request: any, context: ProviderClientContext) => Promise<any>
  stream: (api: any, request: any, context: ProviderClientContext) => Promise<any>
}

export type ProviderResponse = ProviderContentResponse | ReadableStream

export type StreamChunkCallback = (response: string) => Promise<string>
