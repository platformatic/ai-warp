import undici from 'undici'
import { app } from './prompt.ts'
import type { FastifyAiResponse } from '../src/plugins/ai.ts'
import { decodeEventStream } from '../src/lib/event.ts'

const url = 'http://localhost:3000/chat'

const prompts =
[
  {
    stream: false,
    prompts: [
    'Can you help me to prepare a dinner?',
    "I'd like to prepare a dinner for my 2 kids, they love fish and potatoes",
    "Oh I forgot, they don't like garlic. Also, I don't think the cheese is a good idea to put on top of fish. Since you suggest to use the oven, add some tomatoes",
    'Sounds delicious! Thank you'
  ]},

  {
    stream: true,
    prompts: [
    'Can you help me to schedule a trip?',
    "I'd like to go on a nice sea town with my family in Italy",
    "Great, I'd like to visit some places, please schedule a week trip for me",
    'Thank you!'
  ]},
]

const headers = {
  'Content-Type': 'application/json'
}

async function main () {
  const server = await app({ start: true, logger: { level: 'debug' } })

  for (const set of prompts) {
    console.log('\n**********')

    for (const prompt of set.prompts) {
      console.log('\n>>>', prompt)

      const response = await undici.request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt, stream: set.stream })
      })

      if (set.stream) {
        let buffer = ''
        for await (const chunk of response.body) {
          const r = new TextDecoder().decode(chunk)
          buffer += r
          
          // Process complete events from buffer
          const events = decodeEventStream(buffer)
          for (const event of events) {
            if (event.event === 'content') {
              console.log('<<<', event.data.response)
            } else if (event.event === 'error') {
              console.error('Error:', event.data.message)
            }
          }
          
          // Keep any remaining incomplete data in buffer
          const lastDoubleNewline = buffer.lastIndexOf('\n\n')
          if (lastDoubleNewline !== -1) {
            buffer = buffer.substring(lastDoubleNewline + 2)
          }          
        }
      } else {
        const responseData = await response.body.json() as FastifyAiResponse
        if (responseData instanceof ReadableStream) {
          throw new Error('Unexpected ReadableStream response for non-streaming request')
        }
        console.log('<<<', responseData.text)
      }
    }

    console.log('\n**********\n')
  }

  server.close()
}

main()
