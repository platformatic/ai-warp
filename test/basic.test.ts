import { test, mock } from 'node:test'
import assert from 'node:assert'

import { Ai } from '../src/lib/ai.ts'

const apiKey = 'test'

test('should be able to perform a basic prompt', async () => {
  const client = {
    responses: {
      create: async () => {
        return {
          output_text: 'All good'
        }
      }
    }
  }
  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?'
  })

  assert.equal(response.text, 'All good')
})

test('should be able to perform a prompt with options', async () => {
  const client = {
    responses: {
      create: mock.fn(async () => {
        return {
          output_text: 'All good'
        }
      })
    }
  }
  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      maxTokens: 1000,
    }
  })

  assert.deepEqual(client.responses.create.mock.calls[0].arguments, [{
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ],
    temperature: 0.5,
    max_output_tokens: 1000,
    stream: undefined,
  }])
  assert.equal(response.text, 'All good')
})

test('should be able to perform a prompt with stream', async () => {
  const client = {
    responses: {
      create: mock.fn(async () => {
        return {
          output_text: 'All good'
        }
      })
    }
  }
  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      stream: true,
    }
  })

  assert.deepEqual(client.responses.create.mock.calls[0].arguments, [{
    model: 'gpt-4o-mini',
    input: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ],
    max_output_tokens: undefined,
    temperature: undefined,
    stream: true,
  }])
  assert.equal(response.text, 'All good')
})

// session id, multiple concurrent prompts
