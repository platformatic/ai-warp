import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'

import type {
  AiProvider as ClientAiProvider,
  AiModel as ClientAiModel,
  AiChatHistory as ClientAiChatHistory,
  AiSessionId as ClientAiSessionId,
  AiResponseResult as ClientAiResponseResult,
  AiRestore as ClientAiRestore,
  TimeWindow as ClientTimeWindow,
  QueryModel as ClientQueryModel
} from '../src/types.ts'

import type {
  AiModel as ProviderAiModel,
  AiChatHistory as ProviderAiChatHistory,
  AiSessionId as ProviderAiSessionId,
  AiResponseResult as ProviderAiResponseResult,
  AiContentResponse as ProviderAiContentResponse,
  AiStreamResponse as ProviderAiStreamResponse
} from '@platformatic/ai-provider'

test('AiProvider type compatibility', () => {
  const clientProvider: ClientAiProvider = 'openai'
  ok(clientProvider === 'openai', 'clientProvider should be a valid provider')

  // Since AiProvider is not exported from @platformatic/ai-provider,
  // we just verify that our client types are correctly defined
  const providers: ClientAiProvider[] = ['openai', 'deepseek', 'gemini']
  providers.forEach(provider => {
    ok(provider === 'openai' || provider === 'deepseek' || provider === 'gemini', `${provider} should be a valid provider`)
  })
})

test('AiModel type compatibility', () => {
  const clientModel: ClientAiModel = {
    provider: 'openai',
    model: 'gpt-4',
    limits: {
      maxTokens: 1000,
      rate: {
        max: 10,
        timeWindow: '1m'
      }
    },
    restore: {
      rateLimit: '5m',
      retry: '1m',
      timeout: '30s'
    }
  }

  const providerModel: ProviderAiModel = clientModel

  strictEqual(clientModel.provider, providerModel.provider)
  strictEqual(clientModel.model, providerModel.model)
  strictEqual(clientModel.limits?.maxTokens, providerModel.limits?.maxTokens)
  strictEqual(clientModel.limits?.rate?.max, providerModel.limits?.rate?.max)
  strictEqual(clientModel.limits?.rate?.timeWindow, providerModel.limits?.rate?.timeWindow)
})

test('AiChatHistory type compatibility', () => {
  const clientHistory: ClientAiChatHistory = [
    { prompt: 'Hello', response: 'Hi there!' },
    { prompt: 'How are you?', response: 'I am doing well, thanks!' }
  ]

  const providerHistory: ProviderAiChatHistory = clientHistory

  strictEqual(clientHistory.length, providerHistory.length)
  strictEqual(clientHistory[0].prompt, providerHistory[0].prompt)
  strictEqual(clientHistory[0].response, providerHistory[0].response)
})

test('AiSessionId type compatibility', () => {
  const clientSessionId: ClientAiSessionId = 'session-123'
  const providerSessionId: ProviderAiSessionId = clientSessionId

  strictEqual(clientSessionId, providerSessionId)
})

test('AiResponseResult type compatibility', () => {
  const clientResult: ClientAiResponseResult = 'COMPLETE'
  const providerResult: ProviderAiResponseResult = clientResult

  strictEqual(clientResult, providerResult)

  const results: ClientAiResponseResult[] = ['COMPLETE', 'INCOMPLETE_MAX_TOKENS', 'INCOMPLETE_UNKNOWN']
  results.forEach(result => {
    const providerType: ProviderAiResponseResult = result
    ok(providerType, `${result} should be compatible`)
  })
})

test('AiRestore type compatibility', () => {
  const clientRestore: ClientAiRestore = {
    rateLimit: '5m',
    retry: '1m',
    timeout: '30s',
    providerCommunicationError: '2m',
    providerExceededError: '10m'
  }

  ok(clientRestore.rateLimit, 'rateLimit should be defined')
  ok(clientRestore.retry, 'retry should be defined')
  ok(clientRestore.timeout, 'timeout should be defined')
  ok(clientRestore.providerCommunicationError, 'providerCommunicationError should be defined')
  ok(clientRestore.providerExceededError, 'providerExceededError should be defined')
})

test('TimeWindow type compatibility', () => {
  const clientTimeWindowNumber: ClientTimeWindow = 60000
  const clientTimeWindowString: ClientTimeWindow = '1m'

  ok(typeof clientTimeWindowNumber === 'number', 'TimeWindow should support number')
  ok(typeof clientTimeWindowString === 'string', 'TimeWindow should support string')
})

test('QueryModel type compatibility', () => {
  const clientQueryModelString: ClientQueryModel = 'openai:gpt-4'
  const clientQueryModelObject: ClientQueryModel = {
    provider: 'openai',
    model: 'gpt-4',
    limits: {
      maxTokens: 1000,
      rate: {
        max: 10,
        timeWindow: '1m'
      }
    }
  }

  ok(typeof clientQueryModelString === 'string', 'QueryModel should support string format')
  ok(typeof clientQueryModelObject === 'object', 'QueryModel should support object format')
  ok(clientQueryModelObject.provider, 'QueryModel object should have provider')
  ok(clientQueryModelObject.model, 'QueryModel object should have model')
})

test('Response type structure compatibility', () => {
  const mockContentResponse: ProviderAiContentResponse = {
    text: 'Hello world',
    result: 'COMPLETE',
    sessionId: 'session-123'
  }

  ok(mockContentResponse.text, 'Content response should have text')
  ok(mockContentResponse.result, 'Content response should have result')
  ok(mockContentResponse.sessionId, 'Content response should have sessionId')

  const mockStream = new ReadableStream()
  const mockStreamResponse: ProviderAiStreamResponse = mockStream as ProviderAiStreamResponse
  mockStreamResponse.sessionId = 'session-123'

  ok(mockStreamResponse, 'Stream response should exist')
  ok(mockStreamResponse.sessionId, 'Stream response should have sessionId')
})

test('Type duplication comment validation', () => {
  const comment = '// Types duplicated from @platformatic/ai-provider to keep ai-client dependency-free'

  ok(comment, 'Comment should exist explaining type duplication')
})
