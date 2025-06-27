import type { FastifyError } from '@fastify/error'
import fastJson from 'fast-json-stringify'

const stringifyEventData = fastJson({
  title: 'Stream Event Data',
  type: 'object',
  properties: {
    // Success
    response: { type: 'string' },
    // Error
    code: { type: 'string' },
    message: { type: 'string' }
  }
})

export interface AiStreamEventContent {
  response: string
}

export type AiStreamEvent = {
  event: 'content'
  data: AiStreamEventContent
} | {
  event: 'error'
  data: FastifyError
}

/**
 * Encode an event to the Event Stream format
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format
 */
export function encodeEvent ({ event, data }: AiStreamEvent): Uint8Array {
  const jsonString = stringifyEventData(data)
  const eventString = `event: ${event}\ndata: ${jsonString}\n\n`

  return new TextEncoder().encode(eventString)
}

/**
 * Decode Event Stream format chunks
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format
 */
export function decodeEventStream (chunk: string): AiStreamEvent[] {
  const events: AiStreamEvent[] = []
  const lines = chunk.split('\n')

  let currentEvent: string | null = null
  let currentData: string | null = null

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim()
    } else if (line.startsWith('data: ')) {
      currentData = line.substring(6).trim()
    } else if (line === '' && currentEvent && currentData) {
      // End of event, parse the data
      try {
        const parsedData = JSON.parse(currentData)
        if (currentEvent === 'content') {
          events.push({
            event: 'content',
            data: parsedData as AiStreamEventContent
          })
        } else if (currentEvent === 'error') {
          events.push({
            event: 'error',
            data: parsedData as FastifyError
          })
        }
      } catch (error) {
        console.error('Failed to parse event data:', error)
      }

      // Reset for next event
      currentEvent = null
      currentData = null
    }
  }

  return events
}
