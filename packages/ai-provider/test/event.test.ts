import { test } from 'node:test'
import assert from 'node:assert'
import { parseEventStream } from '../src/lib/event.ts'

test('parseEventStream should parse simple data-only message', () => {
  const input = 'data: some text\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'some text' }
  ])
})

test('parseEventStream should parse multiple data lines', () => {
  const input = 'data: another message\ndata: with two lines\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'another message\nwith two lines' }
  ])
})

test('parseEventStream should parse multiple data-only messages', () => {
  const input = 'data: first message\n\ndata: second message\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'first message' },
    { data: 'second message' }
  ])
})

test('parseEventStream should handle empty data lines', () => {
  const input = 'data:\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: '' }
  ])
})

test('parseEventStream should handle data field without colon', () => {
  const input = 'data\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: '' }
  ])
})

test('parseEventStream should parse named events with data', () => {
  const input = 'event: userconnect\ndata: {"username": "bobby", "time": "02:33:48"}\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: 'userconnect', data: '{"username": "bobby", "time": "02:33:48"}' }
  ])
})

test('parseEventStream should parse multiple named events', () => {
  const input = `event: userconnect
data: {"username": "bobby", "time": "02:33:48"}

event: usermessage
data: {"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}

event: userdisconnect
data: {"username": "bobby", "time": "02:34:23"}
`
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: 'userconnect', data: '{"username": "bobby", "time": "02:33:48"}' },
    { event: 'usermessage', data: '{"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}' },
    { event: 'userdisconnect', data: '{"username": "bobby", "time": "02:34:23"}' }
  ])
})

test('parseEventStream should handle event field without colon', () => {
  const input = 'event\ndata: test\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: '', data: 'test' }
  ])
})

test('parseEventStream should handle event without data', () => {
  const input = 'event: ping\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: 'ping' }
  ])
})

test('parseEventStream should parse mixed named events and data-only messages', () => {
  const input = `event: userconnect
data: {"username": "bobby", "time": "02:33:48"}

data: Here's a system message of some kind that will get used
data: to accomplish some task.

event: usermessage
data: {"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}
`
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: 'userconnect', data: '{"username": "bobby", "time": "02:33:48"}' },
    { data: "Here's a system message of some kind that will get used\nto accomplish some task." },
    { event: 'usermessage', data: '{"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}' }
  ])
})

test('parseEventStream should parse id field', () => {
  const input = 'id: 123\ndata: test message\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { id: '123', data: 'test message' }
  ])
})

test('parseEventStream should parse retry field', () => {
  const input = 'retry: 3000\ndata: test message\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { retry: 3000, data: 'test message' }
  ])
})

test('parseEventStream should ignore invalid retry values', () => {
  const input = 'retry: not-a-number\ndata: test message\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'test message' }
  ])
})

test('parseEventStream should parse all fields together', () => {
  const input = 'id: 456\nevent: update\ndata: content here\nretry: 1000\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { id: '456', event: 'update', data: 'content here', retry: 1000 }
  ])
})

test('parseEventStream should handle fields without colons', () => {
  const input = 'id\nevent\ndata: test\nretry\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { id: '', event: '', data: 'test', retry: 0 }
  ])
})

test('parseEventStream should skip comment lines', () => {
  const input = ': this is a test stream\n\ndata: some text\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'some text' }
  ])
})

test('parseEventStream should handle multiple comment lines', () => {
  const input = ': comment 1\n: comment 2\ndata: actual data\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'actual data' }
  ])
})

test('parseEventStream should handle empty lines without events', () => {
  const input = '\n\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [])
})

test('parseEventStream should handle stream without final empty line', () => {
  const input = 'data: incomplete stream'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'incomplete stream' }
  ])
})

test('parseEventStream should handle leading/trailing whitespace in field values', () => {
  const input = 'event:  spaced-event  \ndata:  spaced data  \n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: ' spaced-event  ', data: ' spaced data  ' }
  ])
})

test('parseEventStream should ignore unknown fields', () => {
  const input = 'custom-field: ignored\ndata: test\nunknown: also ignored\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'test' }
  ])
})

test('parseEventStream should handle multiple consecutive empty lines', () => {
  const input = 'data: first\n\n\n\ndata: second\n\n'
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'first' },
    { data: 'second' }
  ])
})

test('parseEventStream should parse the MDN data-only example', () => {
  const input = `: this is a test stream

data: some text

data: another message
data: with two lines
`
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { data: 'some text' },
    { data: 'another message\nwith two lines' }
  ])
})

test('parseEventStream should parse the MDN named events example', () => {
  const input = `event: userconnect
data: {"username": "bobby", "time": "02:33:48"}

event: usermessage
data: {"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}

event: userdisconnect
data: {"username": "bobby", "time": "02:34:23"}

event: usermessage
data: {"username": "sean", "time": "02:34:36", "text": "Bye, bobby."}
`
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: 'userconnect', data: '{"username": "bobby", "time": "02:33:48"}' },
    { event: 'usermessage', data: '{"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}' },
    { event: 'userdisconnect', data: '{"username": "bobby", "time": "02:34:23"}' },
    { event: 'usermessage', data: '{"username": "sean", "time": "02:34:36", "text": "Bye, bobby."}' }
  ])
})

test('parseEventStream should parse the MDN mixing example', () => {
  const input = `event: userconnect
data: {"username": "bobby", "time": "02:33:48"}

data: Here's a system message of some kind that will get used
data: to accomplish some task.

event: usermessage
data: {"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}
`
  const result = parseEventStream(input)

  assert.deepEqual(result, [
    { event: 'userconnect', data: '{"username": "bobby", "time": "02:33:48"}' },
    { data: "Here's a system message of some kind that will get used\nto accomplish some task." },
    { event: 'usermessage', data: '{"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}' }
  ])
})
