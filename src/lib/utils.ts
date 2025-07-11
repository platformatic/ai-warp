import { InvalidTimeWindowNumberInputError, InvalidTimeWindowStringInputError, InvalidTimeWindowUnitError } from './errors.ts'
import { decodeEventStream } from './event.ts'

/**
 * Process a cloned stream to accumulate the complete response
 */
export async function processStream (stream: ReadableStream): Promise<string | undefined> {
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
          return
        }
      }
    }

    return response
  } finally {
    reader.releaseLock()
  }
}

export function parseTimeWindow (timeWindow: number | string, key: string): number {
  if (typeof timeWindow === 'number') {
    if (timeWindow < 0) {
      throw new InvalidTimeWindowNumberInputError(key, timeWindow)
    }

    return timeWindow
  }

  const match = timeWindow.match(/^(\d+)(ms|[smhd])$/)
  if (!match) {
    throw new InvalidTimeWindowStringInputError(key, timeWindow)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
    default: throw new InvalidTimeWindowUnitError(unit)
  }
}
