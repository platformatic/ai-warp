import { buildClient } from '../dist/index.js'

const client = buildClient({
  url: process.env.AI_URL || 'http://127.0.0.1:3042'
})

async function chatWithAI () {
  let sessionId

  try {
    // First message - start new conversation
    console.log('🤖 Starting new conversation...')
    const response1 = await client.ask({
      prompt: "Hello! I'm planning a trip to Japan. Can you help me?",
      stream: true
    })

    console.log("User: Hello! I'm planning a trip to Japan. Can you help me?")
    process.stdout.write('AI: ')

    // Get sessionId from response headers (available immediately)
    sessionId = response1.headers.get('x-session-id')
    console.log('\n📝 Session ID from headers:', sessionId)

    for await (const message of response1.stream) {
      if (message.type === 'content') {
        process.stdout.write(message.content)
      } else if (message.type === 'done') {
        console.log('\n')
        // Verify sessionId from response (if available)
        if (message.response && message.response.sessionId) {
          console.log('📝 Session ID from response:', message.response.sessionId)
        }
      } else if (message.type === 'error') {
        console.error('\n❌ Stream error:', message.error.message)
        return
      }
    }

    // Continue conversation with follow-up questions
    const followUpQuestions = [
      "What's the best time to visit?",
      'What are the must-see places in Tokyo?',
      'Any food recommendations?'
    ]

    for (const question of followUpQuestions) {
      console.log('\n' + '='.repeat(50))
      console.log('User:', question)
      process.stdout.write('AI: ')

      if (!sessionId) {
        console.error('❌ No sessionId available, cannot continue conversation')
        break
      }

      const response = await client.ask({
        prompt: question,
        sessionId, // Continue the conversation
        stream: true
      })

      for await (const message of response.stream) {
        if (message.type === 'content') {
          process.stdout.write(message.content)
        } else if (message.type === 'done') {
          console.log('\n')
          // Session ID remains the same for continued conversation
          if (message.response && message.response.sessionId) {
            console.log('📝 Session continues:', message.response.sessionId)
          }
        } else if (message.type === 'error') {
          console.error('\n❌ Stream error:', message.error.message)
          break
        }
      }
    }

    console.log('\n✅ Conversation completed!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

// Run the chat
chatWithAI()
