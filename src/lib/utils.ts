import { decodeEventStream } from './event.ts'

/**
 * Process a cloned stream to accumulate the complete response
 */
export async function processStream (stream: ReadableStream): Promise<string> {
  const reader = stream.getReader()
  let response = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      // Decode the chunk from Uint8Array to string
      const chunkString = new TextDecoder().decode(value)

      // Parse the event stream format to extract events
      const events = decodeEventStream(chunkString)

      // Accumulate content from all content events
      for (const event of events) {
        if (event.event === 'content') {
          response += event.data.response
        }
        if (event.event === 'error') {
          // TODO handle error
          throw new Error(event.data.message)
        }
      }
    }

    return response
  } finally {
    reader.releaseLock()
  }
}
