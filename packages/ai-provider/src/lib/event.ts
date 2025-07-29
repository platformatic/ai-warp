import type { FastifyError } from '@fastify/error'
import fastJson from 'fast-json-stringify'
import type { AiResponseResult } from './ai.ts'

const stringifyEventData = fastJson({
  title: 'Stream Event Data',
  type: 'object',
  properties: {
    // Success
    response: { type: 'string' },
    prompt: { type: 'string' },
    // Error
    code: { type: 'string' },
    message: { type: 'string' }
  }
})

export interface AiStreamEventContent {
  response: string
}

export interface AiStreamEventEnd {
  response: AiResponseResult
}

export type AiStreamEventType = 'prompt' | 'response'

export type AiStreamEvent = {
  id: string
  event: 'content'
  type: AiStreamEventType
  data: AiStreamEventContent
} |
{
  id: string
  event: 'end'
  data: AiStreamEventEnd
} |
{
  id: string
  event: 'error'
  data: FastifyError
}

export function createEventId (): string {
  return crypto.randomUUID()
}

/**
 * Encode an event to the Event Stream format
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format
 */
export function encodeEvent ({ id, event, data }: AiStreamEvent): Uint8Array {
  const jsonString = stringifyEventData(data)
  const eventString = `id: ${id}\nevent: ${event}\ndata: ${jsonString}\n\n`

  return Buffer.from(eventString, 'utf8')
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
  let currentType: AiStreamEventType | null = null

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim()
    } else if (line.startsWith('data: ')) {
      currentData = line.substring(6).trim()
    } else if (line.startsWith('type: ')) {
      currentType = line.substring(6).trim() as AiStreamEventType
    } else if (line === '' && currentEvent && currentData) {
      // End of event, parse the data
      try {
        const parsedData = JSON.parse(currentData)
        if (currentEvent === 'content') {
          events.push({
            id: createEventId(),
            event: 'content',
            data: parsedData as AiStreamEventContent,
            type: currentType as AiStreamEventType
          })
        } if (currentEvent === 'end') {
          events.push({
            id: createEventId(),
            event: 'end',
            data: parsedData as AiStreamEventEnd
          })
        } else if (currentEvent === 'error') {
          events.push({
            id: createEventId(),
            event: 'error',
            data: parsedData as FastifyError
          })
        }
      } catch (error) {
        // TODO throw error, use logger
        console.error('Failed to parse event data:', error)
      }

      // Reset for next event
      currentEvent = null
      currentData = null
    }
  }

  return events
}

export interface ParsedEvent {
  event?: string
  data?: string
  id?: string
  retry?: number
}

export function parseEventStream (chunk: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  const lines = chunk.split('\n')

  let currentEvent: ParsedEvent = {}
  let dataLines: string[] = []

  for (const line of lines) {
    // Skip comments (lines starting with :)
    if (line.startsWith(':')) {
      continue
    }

    // Empty line indicates end of event
    if (line === '') {
      if (dataLines.length > 0 || currentEvent.event || currentEvent.id || currentEvent.retry) {
        // Join multiple data lines with newlines
        if (dataLines.length > 0) {
          currentEvent.data = dataLines.join('\n')
        }
        events.push(currentEvent)
      }
      // Reset for next event
      currentEvent = {}
      dataLines = []
      continue
    }

    // Parse field and value
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      // Line doesn't contain colon, treat entire line as field name with empty value
      const fieldName = line.trim()
      if (fieldName === 'data') {
        dataLines.push('')
      } else if (fieldName === 'event') {
        currentEvent.event = ''
      } else if (fieldName === 'id') {
        currentEvent.id = ''
      } else if (fieldName === 'retry') {
        currentEvent.retry = 0
      }
      continue
    }

    const fieldName = line.substring(0, colonIndex).trim()
    let fieldValue = line.substring(colonIndex + 1)

    // Remove leading space from value if present
    if (fieldValue.startsWith(' ')) {
      fieldValue = fieldValue.substring(1)
    }

    switch (fieldName) {
      case 'event':
        currentEvent.event = fieldValue
        break
      case 'data':
        dataLines.push(fieldValue)
        break
      case 'id':
        currentEvent.id = fieldValue
        break
      case 'retry':
        // eslint-disable-next-line no-case-declarations
        const retryValue = parseInt(fieldValue, 10)
        if (!isNaN(retryValue)) {
          currentEvent.retry = retryValue
        }
        break
      // All other field names are ignored according to spec
    }
  }

  // Handle case where stream doesn't end with empty line
  if (dataLines.length > 0 || currentEvent.event || currentEvent.id || currentEvent.retry) {
    if (dataLines.length > 0) {
      currentEvent.data = dataLines.join('\n')
    }
    events.push(currentEvent)
  }

  return events
}
