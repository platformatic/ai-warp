import undici from 'undici'
import { app } from './prompt.ts'
import type { FastifyAiResponse } from '../src/plugins/ai.ts'

const url = 'http://localhost:3000/chat'

const prompts = [
  'Can you help me to prepare a dinner?',
  "I'd like to prepare a dinner for my 2 kids, they love fish and potatoes",
  "Oh I forgot, they don't like garlic. Also, I don't think the cheese is a good idea to put on top of fish. Since you suggest to use the oven, add some tomatoes",
  'Sounds delicious! Thank you'
]

// TODO concurrent multiple prompts
// some use stream
// use sessionId

const headers = {
  'Content-Type': 'application/json'
}

async function main () {
  const server = await app({ start: true, logger: { level: 'debug' } })

  console.log('\n**********')

  // for (const prompt of prompts) {
  //   console.log('\n>>>', prompt)

  //   const response = await undici.request(url, {
  //     method: 'POST',
  //     headers,
  //     body: JSON.stringify({ prompt })
  //   })

  //   console.log('<<<', (await response.body.json() as FastifyAiResponse).text)
  // }

  // console.log('\n**********\n')

  server.close()
}

main()
