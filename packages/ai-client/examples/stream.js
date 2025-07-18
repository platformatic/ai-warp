import { buildClient } from '../dist/index.js'

const client = buildClient({
  url: 'http://127.0.0.1:3042'
})

try {
  const stream = await client.ask({
    prompt: 'List the first 5 prime numbers',
    stream: true
  })

  console.log({ headers: stream.headers })

  stream.on('data', (message) => {
    if (message.type === 'content') {
      process.stdout.write(message.content)
    } else if (message.type === 'done') {
      console.log('\n\n *** Stream completed!')
      console.log('Final response:', message.response)
    } else if (message.type === 'error') {
      console.error('! Stream error:', message.error)
    }
  })

  stream.on('end', () => {
    console.log('\n *** Stream ended')
  })

  stream.on('error', (error) => {
    console.error('! Stream error:', error)
  })
} catch (error) {
  console.error('! Error:', error.message)
}