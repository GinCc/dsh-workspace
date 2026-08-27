/**
 * End-to-end validation for the session-import converter: parse sample
 * transcripts from each supported agent, generate DSH events, and feed them
 * through the real Session.fromRestore validation (format version, envelope
 * shape, seq continuity, surface transitions, relational invariants).
 *
 * Run from the DSH checkout so tsx and the workspace packages resolve:
 *   /Users/gin/my/code/deepseek-harness/node_modules/.bin/tsx <this file>
 */
import { parseSource, buildEvents } from '/Users/gin/my/code/dsh-workspace/dsh-plugins/dsh-plugin-session-import/impl.js'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '/Users/gin/my/code/deepseek-harness/packages/core/session/src/index.ts'

const assert = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`  ok — ${message}`)
}

/* -------------------------------------------------------------------------- */

const claudeCodeText = [
  JSON.stringify({ type: 'summary', summary: 'prior context', leafUuid: 'x' }),
  JSON.stringify({
    type: 'user', timestamp: '2026-08-20T10:00:00.000Z', cwd: '/tmp/demo', isMeta: true,
    message: { role: 'user', content: 'meta injection should be skipped' },
  }),
  JSON.stringify({
    type: 'user', timestamp: '2026-08-20T10:00:01.000Z', cwd: '/tmp/demo', uuid: 'u1',
    message: { role: 'user', content: '帮我看看这个报错' },
  }),
  JSON.stringify({
    type: 'assistant', timestamp: '2026-08-20T10:00:05.000Z', uuid: 'a1', requestId: 'r1',
    message: {
      role: 'assistant', model: 'claude-sonnet-4-6',
      content: [
        { type: 'thinking', thinking: '先看堆栈。', signature: 'x' },
        { type: 'text', text: '这个报错是空指针……' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
      usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 900, cache_creation_input_tokens: 30 },
    },
  }),
  JSON.stringify({
    type: 'user', timestamp: '2026-08-20T10:00:06.000Z', uuid: 'u2',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file list' }] },
  }),
  JSON.stringify({
    type: 'assistant', timestamp: '2026-08-20T10:00:09.000Z', uuid: 'a2',
    message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: '修好了。' }] },
  }),
].join('\n')

const codexText = [
  JSON.stringify({ timestamp: '2026-08-21T09:00:00.000Z', type: 'session_meta', payload: { cwd: '/tmp/codex' } }),
  JSON.stringify({ timestamp: '2026-08-21T09:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } }),
  JSON.stringify({ timestamp: '2026-08-21T09:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '写一个快速排序' }] } }),
  JSON.stringify({ timestamp: '2026-08-21T09:00:03.000Z', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: '标准双 partition。' }] } }),
  JSON.stringify({ timestamp: '2026-08-21T09:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'function quicksort(…)' }] } }),
  JSON.stringify({ timestamp: '2026-08-21T09:00:05.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } }),
  JSON.stringify({ timestamp: '2026-08-21T09:00:06.000Z', type: 'event_msg', payload: { type: 'token_count', info: {} } }),
].join('\n')

const openaiText = JSON.stringify([
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: '你好' },
  { role: 'assistant', content: [{ type: 'text', text: '你好！有什么可以帮你？' }] },
  { role: 'user', content: '再讲讲 token' },
  { role: 'assistant', content: 'Token 是……' },
])

/* -------------------------------------------------------------------------- */

function validateCase(label, text, checks) {
  console.log(`\n[${label}]`)
  const conversation = parseSource(`${label}.jsonl`, text)
  const built = buildEvents(conversation)
  checks(conversation, built)

  // The real acceptance gate: restore through the production validator.
  // (The constructor appends one `session/end-seed` marker after the seed.)
  const header = { version: SESSION_FORMAT_VERSION, id: SessionId(crypto.randomUUID()), createdAt: built.createdAt }
  const session = Session.fromRestore(header.id, structuredClone(built.events), header)
  assert(session.events.length === built.events.length + 1, `Session.fromRestore accepted all ${built.events.length} events (+seed marker)`)
  return { conversation, built, session }
}

const claude = validateCase('claude-code', claudeCodeText, (conversation, built) => {
  assert(conversation.format === 'claude-code', 'detected claude-code format')
  assert(conversation.cwd === '/tmp/demo', 'carried cwd from transcript')
  assert(built.counts.turns === 1 && built.counts.userMessages === 1, 'one turn with one user message')
  assert(built.counts.assistantMessages === 2, 'two assistant steps in the turn')
  const usageEvent = built.events.find((event) => event.type === 'assistant/message' && event.data.usage !== undefined)
  assert(usageEvent !== undefined
    && usageEvent.data.usage.inputTokens === 120
    && usageEvent.data.usage.cacheReadTokens === 900
    && usageEvent.data.usage.cacheWriteTokens === 30, 'mapped Claude usage buckets')
  const reasoning = usageEvent.data.message.content.find((block) => block.type === 'reasoning')
  assert(reasoning !== undefined && reasoning.text === '先看堆栈。', 'thinking block became reasoning')
  assert(conversation.skippedToolItems === 2, 'skipped tool_use + tool_result items')
  const titleEvent = built.events.findLast((event) => event.type === 'session/title')
  const userSeq = built.events.find((event) => event.type === 'user/message').seq
  assert(titleEvent !== undefined
    && titleEvent.data.title === '帮我看看这个报错'
    && titleEvent.data.source.kind === 'user'
    && titleEvent.data.messageSeqs.length === 1
    && titleEvent.data.messageSeqs[0] === userSeq, 'appended a pinned first-sentence session/title event')
})

const assistant0 = claude.built.events.find((event) => event.type === 'assistant/message')
assert(assistant0.data.message.source.provider === 'claude-code'
  && assistant0.data.message.source.model === 'claude-sonnet-4-6', 'assistant source carries provider/model')

const codex = validateCase('codex', codexText, (conversation, built) => {
  assert(conversation.format === 'codex', 'detected codex format')
  assert(conversation.cwd === '/tmp/codex', 'carried cwd from session_meta')
  assert(built.counts.turns === 1 && built.counts.userMessages === 1, 'one turn with one user message')
  assert(built.counts.assistantMessages === 1, 'one assistant step')
  const blocks = built.events.find((event) => event.type === 'assistant/message').data.message.content
  assert(blocks[0].type === 'reasoning' && blocks[1].type === 'text', 'reasoning summary prepended to assistant text')
  assert(conversation.models[0] === 'gpt-5-codex', 'model taken from turn_context')
  assert(conversation.skippedToolItems === 1, 'skipped function_call item')
})

const openai = validateCase('openai', openaiText, (conversation, built) => {
  assert(conversation.format === 'openai', 'detected openai format')
  assert(built.counts.turns === 2 && built.counts.userMessages === 2, 'two turns')
  assert(built.counts.assistantMessages === 2, 'two assistant messages')
})

/* surface derivation sanity: the ordered surface should carry our messages */
const surface = openai.session
console.log('\nsurface check')
assert(openai.session.events.filter((event) => event.type === 'user/message').length === 2, 'surface holds both user messages')
assert(openai.session.events.filter((event) => event.type === 'assistant/message').length === 2, 'surface holds both assistant messages')

console.log('\nALL CHECKS PASSED')
