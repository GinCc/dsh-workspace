/**
 * Integration test for the token-usage host half: mount the plugin against a
 * mock context, drive the registered HTTP route, and check the folded
 * aggregates. Plain node, no dependencies.
 */
import assert from 'node:assert/strict'
import { apply } from '../dsh-plugin-token-usage/index.js'

/* Two persisted sessions exercising usage folding and revision caching. */
const sessions = [
  {
    header: { id: 's1', createdAt: 1000, cwd: '/a' },
    revision: 'r1',
    events: [
      { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
      { type: 'user/message', seq: 1, time: 1000, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }, surfaceOp: 'append' },
      { type: 'step/start', seq: 2, time: 1001, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 3, time: 1002, data: { turn: 1, step: 1, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'hello' }], source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } }, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 } }, surfaceOp: 'append' },
      { type: 'step/end', seq: 4, time: 1002, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 1003, data: { turn: 1, reason: { kind: 'completed' } } },
      // second assistant message without usage — must count as a call but add zero tokens
      { type: 'turn/start', seq: 6, time: 2000, data: { turn: 2 } },
      { type: 'step/start', seq: 7, time: 2000, data: { turn: 2, step: 1 } },
      { type: 'assistant/message', seq: 8, time: 2001, data: { turn: 2, step: 1, message: { id: 'm3', role: 'assistant', content: [{ type: 'text', text: 'again' }], source: { kind: 'model', provider: 'deepseek', model: 'deepseek-reasoner' } } }, surfaceOp: 'append' },
      { type: 'step/end', seq: 9, time: 2001, data: { turn: 2, step: 1 } },
      { type: 'turn/end', seq: 10, time: 2002, data: { turn: 2, reason: { kind: 'completed' } } },
    ],
  },
  {
    header: { id: 's2', createdAt: 3000 },
    revision: 'r9',
    events: [
      { type: 'turn/start', seq: 0, time: 3000, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 3000, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 3001, data: { turn: 1, step: 1, message: { id: 'm4', role: 'assistant', content: [{ type: 'text', text: 'x' }], source: { kind: 'model', provider: 'claude-code', model: 'claude-sonnet-4-6' } }, usage: { inputTokens: 7, outputTokens: 3 } }, surfaceOp: 'append' },
      { type: 'step/end', seq: 3, time: 3001, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 4, time: 3002, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  },
]

let readCalls = 0
let route
const ctx = {
  webServer: {
    register(entry) {
      assert.equal(entry.kind, 'prefix')
      route = entry
      return () => {}
    },
  },
  sessionPersistence: {
    listSnapshots: async () => sessions.map((s) => ({ header: s.header, revision: s.revision })),
    readFrom: async (id) => {
      readCalls += 1
      return { events: sessions.find((s) => s.header.id === id).events }
    },
  },
  effect: (fn) => {
    fn()
    return () => {}
  },
}

apply(ctx)
assert.ok(route !== undefined, 'route registered')
assert.equal(route.path, '/plugins/token-usage')

async function callStats() {
  const res = {
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body ?? '' },
  }
  await route.handler({ method: 'GET', url: '/plugins/token-usage/stats' }, res)
  return { status: res.status, json: JSON.parse(res.body) }
}

const first = await callStats()
assert.equal(first.status, 200)
assert.equal(first.json.totals.sessions, 2)
assert.equal(first.json.totals.turns, 3)
assert.equal(first.json.totals.inputTokens, 107)
assert.equal(first.json.totals.outputTokens, 53)
assert.equal(first.json.totals.cacheReadTokens, 10)
assert.equal(first.json.totals.cacheWriteTokens, 5)
assert.equal(first.json.byModel.length, 3)
const chat = first.json.byModel.find((m) => m.model === 'deepseek-chat')
assert.equal(chat.calls, 1)
assert.equal(chat.inputTokens, 100)
const reasoner = first.json.byModel.find((m) => m.model === 'deepseek-reasoner')
assert.equal(reasoner.calls, 1, 'usage-less assistant message still counts as a call')
assert.equal(first.json.sessions[0].id, 's1', 'sessions sorted by billed total desc')

// Second read hits the revision cache: no extra persistence reads.
await callStats()
assert.equal(readCalls, 2, 'revision-keyed cache prevented re-reads')

// A changed revision triggers a re-fold for that session only.
sessions[1].revision = 'r10'
const third = await callStats()
assert.equal(readCalls, 3, 'changed revision re-read exactly one session')
assert.equal(third.json.totals.sessions, 2)

// Unknown subpath and bad method are rejected.
{
  const res = { writeHead(status) { this.status = status }, end(body) { this.body = body } }
  await route.handler({ method: 'GET', url: '/plugins/token-usage/other' }, res)
  assert.equal(res.status, 404)
  await route.handler({ method: 'POST', url: '/plugins/token-usage/stats' }, res)
  assert.equal(res.status, 405)
}

console.log('token-usage host: ALL CHECKS PASSED')
