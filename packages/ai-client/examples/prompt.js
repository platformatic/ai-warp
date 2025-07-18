import { buildClient } from '../dist/index.js'

const client = buildClient({
  url: 'http://127.0.0.1:3042'
})

try {
  const response = await client.ask({
    prompt: 'Please give me the first 10 prime numbers',
    models: ['gemini:gemini-2.5-flash'],
    stream: false
  })

  console.log({ headers: response.headers })

  console.log(response)
} catch (error) {
  console.error('Error:', error.message)
}