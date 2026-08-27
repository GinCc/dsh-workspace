/**
 * Discovery test: build a fake $HOME with one Claude Code project and one
 * Codex rollout, then run the real discoverSessions against it (HOME override
 * — os.homedir() reads $HOME on POSIX). Verifies cwd matching, sorting, and
 * the current-workspace flag. Run: node tools/test-discover.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { discoverSessions } from '../dsh-plugin-session-import/impl.js'

const fakeHome = join(import.meta.dirname, '.tmp-fake-home')
rmSync(fakeHome, { recursive: true, force: true })

// Claude Code: one project dir whose transcript records cwd /tmp/demo-ws.
const claudeDir = join(fakeHome, '.claude', 'projects', '-tmp-demo-ws')
mkdirSync(claudeDir, { recursive: true })
writeFileSync(join(claudeDir, 'aaaa.jsonl'), [
  JSON.stringify({ type: 'summary', summary: '会话摘要标题' }),
  JSON.stringify({ type: 'user', timestamp: '2026-08-25T09:00:00.000Z', cwd: '/tmp/demo-ws', message: { role: 'user', content: '第一个问题' } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-08-25T09:00:20.000Z', message: { role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: '回答' }] } }),
].join('\n'))

// Claude Code: another project for a different cwd (should not match).
const otherDir = join(fakeHome, '.claude', 'projects', '-tmp-other-ws')
mkdirSync(otherDir, { recursive: true })
writeFileSync(join(otherDir, 'bbbb.jsonl'), [
  JSON.stringify({ type: 'user', timestamp: '2026-08-26T12:00:00.000Z', cwd: '/tmp/other-ws', message: { role: 'user', content: '别的项目' } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-08-26T12:00:30.000Z', message: { role: 'assistant', model: 'claude-opus-4', content: [{ type: 'text', text: '好的' }] } }),
].join('\n'))

// Codex rollout in the YYYY/MM/DD layout, newer than both Claude files.
const codexDir = join(fakeHome, '.codex', 'sessions', '2026', '08', '26')
mkdirSync(codexDir, { recursive: true })
writeFileSync(join(codexDir, 'rollout-c.jsonl'), [
  JSON.stringify({ timestamp: '2026-08-26T15:00:00.000Z', type: 'session_meta', payload: { cwd: '/tmp/demo-ws' } }),
  JSON.stringify({ timestamp: '2026-08-26T15:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } }),
  JSON.stringify({ timestamp: '2026-08-26T15:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex 的问题' }] } }),
  JSON.stringify({ timestamp: '2026-08-26T15:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex 的回答' }] } }),
].join('\n'))

process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome

// The fake workspace dirs do not exist on disk, so normalizeCwd keeps the
// literal path on both sides — the same string recorded in the transcripts.
const current = '/tmp/demo-ws'

const entries = await discoverSessions(current)
assert.equal(entries.length, 3, 'found all three transcripts')

const matching = entries.filter((entry) => entry.matchesCurrentWorkspace)
assert.equal(matching.length, 2, 'two entries match the current workspace')
assert.ok(matching.every((entry) => entry.cwd === '/tmp/demo-ws'), 'matching entries carry the workspace cwd')
assert.ok(!matching.some((entry) => entry.title === '别的项目'), 'other-workspace session is not flagged')

// Matching entries sort first; among them the newest (codex, 15:00) leads.
assert.equal(matching[0].agent, 'codex', 'newest matching session sorts first')
assert.equal(matching[0].title, 'codex 的问题', 'codex title from first user input')
assert.equal(matching[1].title, '会话摘要标题', 'claude title prefers the summary line')
assert.equal(matching[0].userMessages, 1)
assert.equal(matching[0].assistantMessages, 1)

const other = entries.find((entry) => !entry.matchesCurrentWorkspace)
assert.equal(other.cwd, '/tmp/other-ws')
assert.equal(other.userMessages, 1)

rmSync(fakeHome, { recursive: true, force: true })
console.log('discovery: ALL CHECKS PASSED')
