import { InvalidTimeWindowNumberInputError, InvalidTimeWindowStringInputError, InvalidTimeWindowUnitError } from './errors.ts'

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
