import undici from 'undici'
import jwt from 'jsonwebtoken'
import { app } from './service.ts'
import { decodeEventStream } from '../src/lib/event.ts'
import type { ChatHistory } from '../src/lib/provider.ts'
import type { ContentResponse } from '../src/lib/ai.ts'

const url = 'http://localhost:3000/chat'

type Prompt = {
  stream?: boolean
  sessionId?: string | boolean
  history?: ChatHistory
  prompts: string[]
}

let lastSessionId: string | undefined
const prompts: Prompt[] =
  [
    {
      stream: true,
      prompts: [
        'Can you help me to prepare a dinner?',
        "I'd like to prepare a dinner for my 2 kids, they love fish and potatoes",
        "Oh I forgot, they don't like garlic. Also, I don't think the cheese is a good idea to put on top of fish. Since you suggest to use the oven, add some tomatoes",
        'Sounds delicious! Thank you'
      ]
    },

    {
      stream: true,
      prompts: [
        'Can you help me to schedule a trip?',
        "I'd like to go on a nice sea town with my family in Italy",
        "Great, I'd like to visit some places, please schedule a week trip for me",
        'Thank you!'
      ]
    },

    {
      stream: false,
      history: [
        {
          prompt: 'Can you help me to schedule a trip?',
          response: `
Of course! I'd be happy to help you schedule your trip. Please provide me with some details:
1. Where are you traveling from and to?
2. What are your travel dates?
3. What type of activities are you interested in (e.g., sightseeing, adventure, relaxation)?
4. Do you have a budget in mind?
5. How many people are traveling with you?
Feel free to share any other preferences or requirements you have!
        `
        },
        {
          prompt: "I'd like to go on a nice sea town with my family in Italy",
          response: `
Italy is home to many beautiful seaside towns that are perfect for a family vacation. Here are a few recommendations:
1. **Cinque Terre**: This stunning coastal region consists of five picturesque villages—Monterosso al Mare, Vernazza, Corniglia, Manarola, and Riomaggiore. The colorful houses, breathtaking views, and hiking trails make it a great place for families. There are also lovely beaches where you can relax.
2. **Sorrento**: Overlooking the Bay of Naples, Sorrento is known for its charming streets, beautiful villas, and stunning views of Mount Vesuvius. It’s a great base for exploring nearby attractions like Pompeii and the Amalfi Coast.
3. **Positano**: Famous for its steep cliffs and colorful buildings, Positano is a beautiful town on the Amalfi Coast. While it can be touristy, its stunning scenery and beaches make it worth a visit. Families can enjoy boat trips and exploring nearby towns.
4. **Portofino**: This small fishing village is known for its picturesque harbor and colorful buildings. It’s a great spot for families who enjoy nature, as there are hiking trails and beautiful views. The nearby Parco        
`
        }
      ],
      prompts: [
        "Great, I'd like to visit some places, please schedule a week trip for me",
        'Thank you!'
      ]
    },

    {
      sessionId: true, // start new session
      prompts: [
        'Can you help me to schedule a trip?',
        "I'd like to go on a nice sea town with my family in Italy",
      ]
    },

    {
      sessionId: lastSessionId,
      prompts: [
        'Can you add another place to visit?',
      ]
    },

    {
      sessionId: true, // start new session
      stream: true,
      prompts: [
        'Can you help me to schedule a trip?',
        "I'd like to go on a nice sea town with my family in Italy",
      ]
    }
  ]

const headers = {
  'Content-Type': 'application/json'
}

async function main() {

  if (!process.env.AUTH_JWT_SECRET) {
    console.log('missing AUTH_JWT_SECRET')
    process.exit(-1)
  }

  const server = await app({ start: true, logger: { level: 'debug', transport: { target: 'pino-pretty' } } })

  for (const set of prompts) {
    console.log('\n**********')

    const history = set.history ? structuredClone(set.history) : undefined
    let sessionId = set.sessionId
    for (const prompt of set.prompts) {
      if (sessionId) {
        console.log(' *** sessionId', sessionId)
      }
      
      console.log('\n>>>', prompt)

      const response = await undici.request(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Authorization': 'Bearer ' + jwt.sign({ user: 'test', exp:  Math.floor(Date.now() / 1000) + (60 * 60) }, 
            process.env.AUTH_JWT_SECRET, { algorithm: 'HS256' })
        },
        body: JSON.stringify({ prompt, history, stream: set.stream, sessionId })
      })

      if (response.headers['x-session-id']) {
        sessionId = response.headers['x-session-id'] as string
        console.log(' *** sessionId', sessionId)
        lastSessionId = sessionId
      }

      if (set.stream) {
        let content = ''
        for await (const chunk of response.body) {
          const r = new TextDecoder().decode(chunk)

          // Process complete events from buffer
          const events = decodeEventStream(r)
          for (const event of events) {
            if (event.event === 'content') {
              console.log('<<< * ', event.data.response)
              if(event.data.response) {
                content += event.data.response
              }
            } else if (event.event === 'end') {
              console.log('<<< END', event.data.response)
            } else if (event.event === 'error') {
              console.error('Error:', event.data.message)
            }
          }
        }

        console.log('\n<<<', content)

        if (history) {
          history.push({ prompt, response: content })
        }
      } else {
        const responseData = await response.body.json() as ContentResponse
        console.log('<<<', responseData.text)

        if (history) {
          history.push({ prompt, response: responseData.text })
        }
      }
    }

    console.log('\n**********\n')
  }

  server.close()
}

main()
