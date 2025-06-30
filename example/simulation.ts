import undici from 'undici'
import { app } from './prompt.ts'
import type { FastifyAiResponse } from '../src/plugins/ai.ts'
import { decodeEventStream } from '../src/lib/event.ts'
import type { ChatHistory } from '../src/lib/provider.ts'

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
  // {
  //   stream: false,
  //   prompts: [
  //   'Can you help me to prepare a dinner?',
  //   "I'd like to prepare a dinner for my 2 kids, they love fish and potatoes",
  //   "Oh I forgot, they don't like garlic. Also, I don't think the cheese is a good idea to put on top of fish. Since you suggest to use the oven, add some tomatoes",
  //   'Sounds delicious! Thank you'
  // ]},

  // {
  //   stream: true,
  //   prompts: [
  //   'Can you help me to schedule a trip?',
  //   "I'd like to go on a nice sea town with my family in Italy",
  //   "Great, I'd like to visit some places, please schedule a week trip for me",
  //   'Thank you!'
  // ]},

//   {
//     stream: false,
//     history: [
//       {
//         prompt: 'Can you help me to schedule a trip?',
//         response: `
// Of course! I'd be happy to help you schedule your trip. Please provide me with some details:
// 1. Where are you traveling from and to?
// 2. What are your travel dates?
// 3. What type of activities are you interested in (e.g., sightseeing, adventure, relaxation)?
// 4. Do you have a budget in mind?
// 5. How many people are traveling with you?
// Feel free to share any other preferences or requirements you have!
//         `
//       },
//       {
//         prompt:         "I'd like to go on a nice sea town with my family in Italy",
//         response: `
// Italy is home to many beautiful seaside towns that are perfect for a family vacation. Here are a few recommendations:
// 1. **Cinque Terre**: This stunning coastal region consists of five picturesque villages—Monterosso al Mare, Vernazza, Corniglia, Manarola, and Riomaggiore. The colorful houses, breathtaking views, and hiking trails make it a great place for families. There are also lovely beaches where you can relax.
// 2. **Sorrento**: Overlooking the Bay of Naples, Sorrento is known for its charming streets, beautiful villas, and stunning views of Mount Vesuvius. It’s a great base for exploring nearby attractions like Pompeii and the Amalfi Coast.
// 3. **Positano**: Famous for its steep cliffs and colorful buildings, Positano is a beautiful town on the Amalfi Coast. While it can be touristy, its stunning scenery and beaches make it worth a visit. Families can enjoy boat trips and exploring nearby towns.
// 4. **Portofino**: This small fishing village is known for its picturesque harbor and colorful buildings. It’s a great spot for families who enjoy nature, as there are hiking trails and beautiful views. The nearby Parco        
// `
//       }
//     ],
//     prompts: [
//     "Great, I'd like to visit some places, please schedule a week trip for me",
//     'Thank you!'
//   ]}

// {
//   sessionId: true, // start new session
//   prompts: [
//     'Can you help me to schedule a trip?',
//     "I'd like to go on a nice sea town with my family in Italy",
//   ]
// },

// {
//   sessionId: lastSessionId,
//   prompts: [
//     'Can you add another place to visit?',
//   ]
// }

{
  sessionId: true, // start new session
  stream: true,
  prompts: [
    'Can you help me to schedule a trip?',
    "I'd like to go on a nice sea town with my family in Italy",
  ]
},
]

const headers = {
  'Content-Type': 'application/json'
}

async function main () {
  const server = await app({ start: true, logger: { level: 'debug' } })

  for (const set of prompts) {
    console.log('\n**********')

    const history = set.history ? structuredClone(set.history) : undefined
    let sessionId = set.sessionId
    for (const prompt of set.prompts) {
      if(sessionId) {
        console.log(' *** sessionId', sessionId)
      }
      console.log('\n>>>', prompt)

      const response = await undici.request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt, history, stream: set.stream, sessionId })
      })

      if(response.headers['x-session-id']) {
        sessionId = response.headers['x-session-id'] as string
        console.log(' *** sessionId', sessionId)
        lastSessionId = sessionId
      }

      if (set.stream) {
        let buffer = ''
        for await (const chunk of response.body) {
          const r = new TextDecoder().decode(chunk)
          buffer += r
          
          // Process complete events from buffer
          const events = decodeEventStream(buffer)
          for (const event of events) {
            // TODO sessionId
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
        if(history) {
          history.push({ prompt, response: buffer })
        }
      } else {
        const responseData = await response.body.json() as FastifyAiResponse
        if (responseData instanceof ReadableStream) {
          throw new Error('Unexpected ReadableStream response for non-streaming request')
        }
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
