import { test } from 'node:test'
import assert from 'node:assert'
import { parseTimeWindow } from '../src/lib/utils.ts'

test('parseTimeWindow', () => {
  assert.equal(parseTimeWindow('1s'), 1000)
  assert.equal(parseTimeWindow('1m'), 60000)
  assert.equal(parseTimeWindow('1h'), 3600000)
  assert.equal(parseTimeWindow('1d'), 86400000)
  assert.equal(parseTimeWindow('1000ms'), 1000)
  assert.equal(parseTimeWindow('6000ms'), 6000)
  assert.equal(parseTimeWindow('10h'), 36000000)
  assert.equal(parseTimeWindow('600ms'), 600)

  assert.throws(() => parseTimeWindow('invalid'), /INVALID_TIME_WINDOW_INPUT_ERROR/)
  assert.throws(() => parseTimeWindow('100xz'), /INVALID_TIME_WINDOW_INPUT_ERROR/)
})
