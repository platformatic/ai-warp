import { InvalidTimeWindowNumberInputError, InvalidTimeWindowStringInputError } from './errors.ts'

type TimeWindowUnit = 'ms' | 's' | 'm' | 'h' | 'd'

export function parseTimeWindow (timeWindow: number | string, key?: string): number {
  if (typeof timeWindow === 'number') {
    if (timeWindow < 0) {
      throw new InvalidTimeWindowNumberInputError(key ?? '', timeWindow)
    }

    return timeWindow
  }

  const match = timeWindow.match(/^(\d+)(ms|[smhd])$/)
  if (!match) {
    throw new InvalidTimeWindowStringInputError(key ?? '', timeWindow)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2] as TimeWindowUnit

  switch (unit) {
    case 'ms': return value
    case 's': return value * 1000
    case 'm': return value * 60 * 1000
    case 'h': return value * 60 * 60 * 1000
    case 'd': return value * 24 * 60 * 60 * 1000
  }
}
