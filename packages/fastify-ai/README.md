TODO


### Basic Usage with Fastify

```typescript
import fastify from 'fastify'
import { ai } from '@platformatic/fastify-ai'

const app = fastify({ logger: true })

await app.register(ai, {
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    deepseek: { apiKey: process.env.DEEPSEEK_API_KEY },
    gemini: { apiKey: process.env.GEMINI_API_KEY }
  },
  models: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'gemini', model: 'gemini-2.5-flash' }
  ]
})

app.post('/chat', async (request, reply) => {
  const { prompt, sessionId } = request.body

  const response = await app.ai.request({
    prompt,
    sessionId,
    context: 'You are a helpful assistant.',
    temperature: 0.7,
    stream: true
  }, reply)

  return response
})

await app.listen({ port: 3000 })
```