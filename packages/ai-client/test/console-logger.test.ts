import { test } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert'
import { consoleLogger, nullLogger } from '../src/console-logger.ts'

// Store original console methods to restore them later
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalConsoleError = console.error

// Helper to create mock console methods
function createConsoleMock () {
  const calls: Array<{ method: string; args: any[] }> = []

  const mockLog = (...args: any[]) => {
    calls.push({ method: 'log', args })
  }

  const mockWarn = (...args: any[]) => {
    calls.push({ method: 'warn', args })
  }

  const mockError = (...args: any[]) => {
    calls.push({ method: 'error', args })
  }

  return { calls, mockLog, mockWarn, mockError }
}

test('consoleLogger.debug calls console.log with message only', () => {
  const { calls, mockLog } = createConsoleMock()
  console.log = mockLog

  consoleLogger.debug('Debug message')

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'log')
  strictEqual(calls[0].args.length, 1)
  strictEqual(calls[0].args[0], 'Debug message')

  console.log = originalConsoleLog
})

test('consoleLogger.debug calls console.log with message and data', () => {
  const { calls, mockLog } = createConsoleMock()
  console.log = mockLog

  const testData = { key: 'value', number: 42 }
  consoleLogger.debug('Debug message with data', testData)

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'log')
  strictEqual(calls[0].args.length, 2)
  strictEqual(calls[0].args[0], 'Debug message with data')
  deepStrictEqual(calls[0].args[1], testData)

  console.log = originalConsoleLog
})

test('consoleLogger.info calls console.log with message only', () => {
  const { calls, mockLog } = createConsoleMock()
  console.log = mockLog

  consoleLogger.info('Info message')

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'log')
  strictEqual(calls[0].args.length, 1)
  strictEqual(calls[0].args[0], 'Info message')

  console.log = originalConsoleLog
})

test('consoleLogger.info calls console.log with message and data', () => {
  const { calls, mockLog } = createConsoleMock()
  console.log = mockLog

  const testData = { info: true, items: [1, 2, 3] }
  consoleLogger.info('Info message with data', testData)

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'log')
  strictEqual(calls[0].args.length, 2)
  strictEqual(calls[0].args[0], 'Info message with data')
  deepStrictEqual(calls[0].args[1], testData)

  console.log = originalConsoleLog
})

test('consoleLogger.warn calls console.warn with message only', () => {
  const { calls, mockWarn } = createConsoleMock()
  console.warn = mockWarn

  consoleLogger.warn('Warning message')

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'warn')
  strictEqual(calls[0].args.length, 1)
  strictEqual(calls[0].args[0], 'Warning message')

  console.warn = originalConsoleWarn
})

test('consoleLogger.warn calls console.warn with message and data', () => {
  const { calls, mockWarn } = createConsoleMock()
  console.warn = mockWarn

  const testData = { warning: 'deprecated', version: '1.0.0' }
  consoleLogger.warn('Warning message with data', testData)

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'warn')
  strictEqual(calls[0].args.length, 2)
  strictEqual(calls[0].args[0], 'Warning message with data')
  deepStrictEqual(calls[0].args[1], testData)

  console.warn = originalConsoleWarn
})

test('consoleLogger.error calls console.error with message only', () => {
  const { calls, mockError } = createConsoleMock()
  console.error = mockError

  consoleLogger.error('Error message')

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'error')
  strictEqual(calls[0].args.length, 1)
  strictEqual(calls[0].args[0], 'Error message')

  console.error = originalConsoleError
})

test('consoleLogger.error calls console.error with message and data', () => {
  const { calls, mockError } = createConsoleMock()
  console.error = mockError

  const testData = { error: new Error('Test error'), code: 500 }
  consoleLogger.error('Error message with data', testData)

  strictEqual(calls.length, 1)
  strictEqual(calls[0].method, 'error')
  strictEqual(calls[0].args.length, 2)
  strictEqual(calls[0].args[0], 'Error message with data')
  deepStrictEqual(calls[0].args[1], testData)

  console.error = originalConsoleError
})

test('consoleLogger handles various data types', () => {
  const { calls, mockLog, mockWarn, mockError } = createConsoleMock()
  console.log = mockLog
  console.warn = mockWarn
  console.error = mockError

  // Test with string data
  consoleLogger.debug('String data', 'test string')

  // Test with number data
  consoleLogger.info('Number data', 123)

  // Test with boolean data
  consoleLogger.warn('Boolean data', true)

  // Test with null data (falsy, so only message is passed)
  consoleLogger.error('Null data', null)

  // Test with undefined data (falsy, so only message is passed)
  consoleLogger.debug('Undefined data', undefined)

  // Test with array data
  consoleLogger.info('Array data', [1, 2, 3])

  // Test with nested object data
  consoleLogger.warn('Nested object', { level1: { level2: 'deep value' } })

  strictEqual(calls.length, 7)
  strictEqual(calls[0].args[1], 'test string')
  strictEqual(calls[1].args[1], 123)
  strictEqual(calls[2].args[1], true)
  // null and undefined are falsy, so only message gets passed
  strictEqual(calls[3].args.length, 1) // Only message, no data
  strictEqual(calls[4].args.length, 1) // Only message, no data
  deepStrictEqual(calls[5].args[1], [1, 2, 3])
  deepStrictEqual(calls[6].args[1], { level1: { level2: 'deep value' } })

  console.log = originalConsoleLog
  console.warn = originalConsoleWarn
  console.error = originalConsoleError
})

test('nullLogger.debug is a no-op function', () => {
  const { calls, mockLog } = createConsoleMock()
  console.log = mockLog

  // Should not throw and should not call console.log
  nullLogger.debug('Debug message')
  nullLogger.debug('Debug message with data', { key: 'value' })

  strictEqual(calls.length, 0)

  console.log = originalConsoleLog
})

test('nullLogger.info is a no-op function', () => {
  const { calls, mockLog } = createConsoleMock()
  console.log = mockLog

  // Should not throw and should not call console.log
  nullLogger.info('Info message')
  nullLogger.info('Info message with data', { key: 'value' })

  strictEqual(calls.length, 0)

  console.log = originalConsoleLog
})

test('nullLogger.warn is a no-op function', () => {
  const { calls, mockWarn } = createConsoleMock()
  console.warn = mockWarn

  // Should not throw and should not call console.warn
  nullLogger.warn('Warning message')
  nullLogger.warn('Warning message with data', { key: 'value' })

  strictEqual(calls.length, 0)

  console.warn = originalConsoleWarn
})

test('nullLogger.error is a no-op function', () => {
  const { calls, mockError } = createConsoleMock()
  console.error = mockError

  // Should not throw and should not call console.error
  nullLogger.error('Error message')
  nullLogger.error('Error message with data', { key: 'value' })

  strictEqual(calls.length, 0)

  console.error = originalConsoleError
})

test('nullLogger methods return undefined', () => {
  // All nullLogger methods should return undefined (no-op)
  strictEqual(nullLogger.debug('test'), undefined)
  strictEqual(nullLogger.info('test'), undefined)
  strictEqual(nullLogger.warn('test'), undefined)
  strictEqual(nullLogger.error('test'), undefined)

  strictEqual(nullLogger.debug('test', { data: 'value' }), undefined)
  strictEqual(nullLogger.info('test', { data: 'value' }), undefined)
  strictEqual(nullLogger.warn('test', { data: 'value' }), undefined)
  strictEqual(nullLogger.error('test', { data: 'value' }), undefined)
})

test('consoleLogger and nullLogger implement Logger interface', () => {
  // Verify that both loggers have all required methods
  strictEqual(typeof consoleLogger.debug, 'function')
  strictEqual(typeof consoleLogger.info, 'function')
  strictEqual(typeof consoleLogger.warn, 'function')
  strictEqual(typeof consoleLogger.error, 'function')

  strictEqual(typeof nullLogger.debug, 'function')
  strictEqual(typeof nullLogger.info, 'function')
  strictEqual(typeof nullLogger.warn, 'function')
  strictEqual(typeof nullLogger.error, 'function')
})

test('consoleLogger handles edge cases with data parameter', () => {
  const { calls, mockLog, mockWarn, mockError } = createConsoleMock()
  console.log = mockLog
  console.warn = mockWarn
  console.error = mockError

  // Test with empty object (truthy)
  consoleLogger.debug('Empty object', {})

  // Test with empty array (truthy)
  consoleLogger.info('Empty array', [])

  // Test with zero (falsy, so only message is passed)
  consoleLogger.warn('Zero value', 0)

  // Test with empty string (falsy, so only message is passed)
  consoleLogger.error('Empty string', '')

  // Test with false (falsy, so only message is passed)
  consoleLogger.debug('False value', false)

  strictEqual(calls.length, 5)
  deepStrictEqual(calls[0].args[1], {}) // Empty object is truthy
  deepStrictEqual(calls[1].args[1], []) // Empty array is truthy
  // Falsy values only get message passed
  strictEqual(calls[2].args.length, 1) // Only message, no data (0 is falsy)
  strictEqual(calls[3].args.length, 1) // Only message, no data ('' is falsy)
  strictEqual(calls[4].args.length, 1) // Only message, no data (false is falsy)

  console.log = originalConsoleLog
  console.warn = originalConsoleWarn
  console.error = originalConsoleError
})
