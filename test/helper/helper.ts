import { ReadableStream as ReadableStreamPolyfill } from 'web-streams-polyfill'

// Mock the readable stream to emit chunks that will result in 'All good'
export function mockOpenAiStream (chunks: any[]) {
  return {
    toReadableStream: () => {
      let chunkIndex = 0

      return new ReadableStreamPolyfill({
        start (controller) {
          // Emit the chunks
          const sendChunk = () => {
            if (chunkIndex < chunks.length) {
              const chunk = chunks[chunkIndex++]
              const jsonString = JSON.stringify(chunk)
              const uint8Array = new TextEncoder().encode(jsonString)
              controller.enqueue(uint8Array)
              // Send next chunk after a short delay to simulate streaming
              setTimeout(sendChunk, 10)
            } else {
              controller.close()
            }
          }
          sendChunk()
        }
      })
    }
  }
}

export async function consumeStream (response: ReadableStream) {
  const chunks: string[] = []

  // The response is a ReadableStream that emits Server-sent events
  const reader = (response as ReadableStream).getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const eventData = decoder.decode(value)
      // Parse Server-sent events format
      const lines = eventData.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.substring(6))
          if (data.response) {
            chunks.push(data.response)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return chunks
}
