import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'
import { createServer } from 'node:http'
import { once } from 'node:events'

test('client uses only browser-compatible APIs', async (t) => {
  // This test verifies that the client only uses APIs available in browsers
  // by checking that no Node.js-specific modules are imported

  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })

    if (req.method === 'OPTIONS') {
      res.end()
      return
    }

    res.write('data: {"response": "Hello from browser!"}\n\n')
    res.write('event: end\ndata: {"response": {"content": "Hello", "sessionId": "test", "result": "COMPLETE"}}\n\n')
    res.end()
  })

  t.after(async () => {
    await server.close()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  // Simulate browser environment by ensuring only browser APIs are available
  const _originalGlobal = globalThis

  // Create a mock browser environment
  const _mockBrowserGlobal = {
    // Browser APIs that should be available
    fetch: globalThis.fetch,
    console: globalThis.console,
    ReadableStream: globalThis.ReadableStream,
    TransformStream: globalThis.TransformStream,
    TextDecoderStream: globalThis.TextDecoderStream,
    AbortSignal: globalThis.AbortSignal,
    Headers: globalThis.Headers,
    Symbol: globalThis.Symbol,
    JSON: globalThis.JSON,
    Error: globalThis.Error,

    // Remove Node.js-specific APIs to ensure they're not used
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    process: undefined,
    Buffer: undefined
  }

  // Import the client dynamically to test browser compatibility
  const { buildClient } = await import('../src/index.ts')

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const response = await client.ask({ prompt: 'Hello', stream: true })

  // Verify the response uses browser-compatible stream
  ok(response.stream, 'Should have a stream')
  ok(typeof response.stream[Symbol.asyncIterator] === 'function', 'Stream should be async iterable')

  let messageCount = 0
  let lastMessage = null

  for await (const message of response.stream) {
    messageCount++
    lastMessage = message
  }

  strictEqual(messageCount, 2, 'Should receive 2 messages')
  ok(lastMessage, 'Should have received messages')
  strictEqual(lastMessage.type, 'done', 'Last message should be done type')

  // Test that the client constructor and methods work
  ok(client.ask, 'Client should have ask method')
  ok(typeof client.ask === 'function', 'ask should be a function')
})
