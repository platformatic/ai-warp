import type { Readable } from 'node:stream'
import type { AiModel, AiResponseResult, AiChatHistory, AiSessionId } from '@platformatic/ai-provider'

export interface Logger {
  debug(message: string, data?: any): void
  info(message: string, data?: any): void
  warn(message: string, data?: any): void
  error(message: string, data?: any): void
  error(data: any, message?: string): void
}

export interface ClientOptions {
  url: string
  headers?: Record<string, string>
  timeout?: number
  logger?: Logger
}

export interface AskOptions {
  prompt: string
  sessionId?: AiSessionId
  context?: string | Record<string, any> | any[]
  temperature?: number
  models?: AiModel[]
  history?: AiChatHistory
  stream?: boolean
}

export interface AskResponse {
  content: string
  model?: string
  sessionId?: AiSessionId
  result?: AiResponseResult
}

export interface StreamMessage {
  type: 'content' | 'error' | 'done'
  content?: string
  error?: Error
  response?: AskResponse
}

export interface AIClient {
  ask(options: AskOptions & { stream: true }): Promise<Readable>
  ask(options: AskOptions & { stream?: false }): Promise<AskResponse>
}
