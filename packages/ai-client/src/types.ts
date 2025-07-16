export interface ClientOptions {
  url: string
  headers?: Record<string, string>
  timeout?: number
}

export interface AskOptions {
  prompt: string
  sessionId?: string
  context?: string | Record<string, any> | any[]
  temperature?: number
  model?: string
  messages?: Array<{ role: 'system' | 'user' | 'assistant' | string; content: string }>
  stream?: boolean
}

export interface AskResponse {
  content: string
  model?: string
  sessionId?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface StreamMessage {
  type: 'content' | 'error' | 'done'
  content?: string
  error?: Error
  response?: AskResponse
}

export interface AIClient {
  ask(options: AskOptions): Promise<AsyncIterable<StreamMessage>>
}
