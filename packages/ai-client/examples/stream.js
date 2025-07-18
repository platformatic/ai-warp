import { buildClient } from '../dist/index.js'

const client = buildClient({
  url: process.env.AI_URL || 'http://127.0.0.1:3042'
})

try {
  const response = await client.ask({
    prompt: 'List the first 5 prime numbers',
    stream: true
  })

  console.log('Response headers:', Object.fromEntries(response.headers.entries()))

  for await (const message of response.stream) {
    if (message.type === 'content') {
      process.stdout.write(message.content)
    } else if (message.type === 'done') {
      console.log('\n\n*** Stream completed!')
      console.log('Final response:', message.response)
    } else if (message.type === 'error') {
      console.error('\n! Stream error:', message.error.message)
      break
    }
  }

  console.log('\n*** Stream ended')
} catch (error) {
  console.error('! Error:', error.message)
  process.exit(1)
}
