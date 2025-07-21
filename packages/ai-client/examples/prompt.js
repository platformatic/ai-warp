import { buildClient } from '../dist/index.js'

const client = buildClient({
  url: process.env.AI_URL || 'http://127.0.0.1:3042'
})

try {
  const response = await client.ask({
    prompt: 'Please give me the first 10 prime numbers',
    models: ['gemini:gemini-2.5-flash'],
    stream: false
  })

  console.log('Headers:', Object.fromEntries(response.headers.entries()))
  console.log('Response:', response.content)
} catch (error) {
  console.error('Error:', error.message)
  process.exit(1)
}
