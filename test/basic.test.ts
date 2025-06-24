import { test } from 'node:test'
import assert from 'node:assert'

import { Ai } from '../src/lib/ai.ts'

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
        apiKey: 'test',
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
