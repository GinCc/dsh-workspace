/**
 * dsh-plugin-session-import — host implementation.
 *
 * Mounted by index.js (the shim) with a cache-busting query so config-driven
 * remounts pick up fresh code. Serves JSON endpoints under
 * /plugins/session-import:
 *
 *   POST /inspect     { name, text }            -> preview of an import
 *   POST /import      { name, text }            -> write a new persisted session
 *   POST /discover    { cwd? }                  -> other-agent sessions found on
 *                                                  this machine, current-workspace
 *                                                  matches flagged
 *   POST /import-file { path }                  -> import one discovered file
 *
 * Supported source formats (auto-detected): claude-code JSONL, codex rollout
 * JSONL, and generic OpenAI-style message arrays. The converter emits a
 * canonical DSH event log (seq contiguous from 0, turns/steps numbered from
 * 1) so the imported session replays as a normal read-only conversation.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'

/* -------------------------------------------------------------------------- */
/* limits                                                                      */

const MAX_BODY_BYTES = 256 * 1024 * 1024
const PREVIEW_READ_BYTES = 20 * 1024 * 1024
const MAX_FILES_PER_AGENT = 400
const MAX_DISCOVER_RESULTS = 400

/**
 * On-disk session format version stamped into imported headers. Mirrors
 * SESSION_FORMAT_VERSION from @deepseek-ai/dsh-session (kept literal so this
 * plugin stays dependency-free; a mismatch fails loudly at create()).
 */
const SESSION_FORMAT_VERSION = 3

/* -------------------------------------------------------------------------- */
/* utterance + turn model                                                      */

function utterance(role, blocks, extra = {}) {
  return {
    role,
    blocks,
    ...('model' in extra ? { model: extra.model } : {}),
    ...('usage' in extra ? { usage: extra.usage } : {}),
    ...('time' in extra ? { time: extra.time } : {}),
  }
}

function compactBlocks(blocks) {
  const kept = blocks.filter((block) => block !== undefined && block !== null
    && typeof block.text === 'string' && block.text.length > 0)
  return kept.length > 0 ? kept : null
}

/**
 * First-sentence title: whitespace-normalized text cut at the first sentence
 * terminator (CJK + latin), byte-capped so it stays well inside the title
 * service's limits. Returns null for nothing usable.
 */
function firstSentenceTitle(text, maxChars = 40, maxCharsBytes = 120) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (normalized.length === 0) return null
  const terminators = '。！？!?；;'
  let cut = -1
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]
    if (terminators.includes(ch)) {
      cut = i + 1
      break
    }
    if (ch === '.' && (i === normalized.length - 1 || normalized[i + 1] === ' ')) {
      cut = i + 1
      break
    }
  }
  let candidate = cut > 0 ? normalized.slice(0, cut) : normalized
  const bytes = (value) => Buffer.byteLength(value, 'utf8')
  while (candidate.length > 4 && (candidate.length > maxChars || bytes(candidate) > maxCharsBytes)) {
    candidate = candidate.slice(0, Math.ceil(candidate.length * 0.8))
  }
  candidate = candidate.trim()
  if (candidate.length === 0) return null
  if (candidate.length < normalized.length && !terminators.includes(candidate.at(-1))) {
    const withEllipsis = `${candidate}…`
    if (withEllipsis.length <= maxChars && bytes(withEllipsis) <= maxCharsBytes) candidate = withEllipsis
  }
  return candidate
}

/**
 * Compact stream records for an imported assistant message: one packed run
 * per content block (text or reasoning), matching AssistantStreamRecord —
 * the lossless form dsh embeds in assistant/message events.
 */
function streamRecordsFor(blocks, time) {
  const records = []
  let index = 0
  for (const block of blocks) {
    if (block.type === 'text') {
      records.push({ type: 'text-chunks', time0: time, index, dt: [0], texts: [block.text] })
    } else if (block.type === 'reasoning') {
      records.push({ type: 'reasoning-chunks', time0: time, index, dt: [0], texts: [block.text] })
    }
    index += 1
  }
  return records
}

function titleOf(turns) {
  for (const turn of turns) {
    for (const block of turn.user?.blocks ?? []) {
      if (block.type === 'text') {
        const title = firstSentenceTitle(block.text)
        if (title !== null) return title
      }
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* format: claude-code JSONL                                                   */

function mapClaudeUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const mapped = {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheWriteTokens: num(usage.cache_creation_input_tokens),
  }
  return mapped.inputTokens + mapped.outputTokens + mapped.cacheReadTokens + mapped.cacheWriteTokens > 0
    ? mapped
    : undefined
}

/** Extract user-visible text blocks from one Claude message content field. */
function claudeTextBlocks(rawContent) {
  const blocks = []
  if (typeof rawContent === 'string') {
    blocks.push({ type: 'text', text: rawContent })
  } else if (Array.isArray(rawContent)) {
    for (const item of rawContent) {
      if (item === null || typeof item !== 'object') continue
      if (item.type === 'text' && typeof item.text === 'string') {
        blocks.push({ type: 'text', text: item.text })
      } else if (item.type === 'thinking' && typeof item.thinking === 'string') {
        blocks.push({ type: 'reasoning', text: item.thinking })
      }
    }
  }
  return blocks
}

function parseClaudeCode(name, lines) {
  const turns = []
  const models = new Set()
  const warnings = []
  let skippedToolItems = 0
  let cwd = undefined
  let firstTime = null
  let lastTime = null

  for (const line of lines) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      warnings.push(`${name}: skipped a non-JSON line`)
      continue
    }
    if (record === null || typeof record !== 'object') continue
    if (typeof record.cwd === 'string' && cwd === undefined) cwd = record.cwd
    const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN
    const timeMs = Number.isFinite(time) ? time : undefined
    if (timeMs !== undefined) {
      if (firstTime === null || timeMs < firstTime) firstTime = timeMs
      if (timeMs > lastTime) lastTime = timeMs
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue
    if (record.isMeta === true) continue
    const message = record.message
    if (message === null || typeof message !== 'object') continue

    const blocks = claudeTextBlocks(message.content)
    // Count tool plumbing for the skipped figure even on kept lines.
    if (Array.isArray(message.content)) {
      skippedToolItems += message.content.filter((item) => item !== null && typeof item === 'object'
        && item.type !== 'text' && item.type !== 'thinking').length
    }
    const kept = compactBlocks(blocks)

    if (record.type === 'user') {
      if (kept === null) continue // tool_result-only user lines are tool plumbing
      turns.push({ user: utterance('user', kept, { time: timeMs }), assistants: [] })
    } else {
      const modelName = typeof message.model === 'string' && message.model.length > 0
        ? message.model
        : 'claude'
      models.add(modelName)
      if (kept === null) continue // tool_use-only assistant lines carry no transcript content
      const turn = turns.at(-1) ?? { user: null, assistants: [] }
      if (turns.length === 0) turns.push(turn)
      turn.assistants.push(utterance('assistant', kept, {
        model: { provider: 'claude-code', model: modelName },
        usage: mapClaudeUsage(message.usage),
        time: timeMs,
      }))
    }
  }

  return {
    format: 'claude-code',
    sourceAgent: 'Claude Code',
    turns,
    models: [...models],
    cwd,
    firstTime,
    lastTime,
    skippedToolItems,
    warnings,
  }
}

/* -------------------------------------------------------------------------- */
/* format: codex rollout JSONL                                                 */

function parseCodex(name, lines) {
  const turns = []
  const models = new Set()
  const warnings = []
  let skippedToolItems = 0
  let cwd = undefined
  let firstTime = null
  let lastTime = null
  let currentModel = 'gpt'
  let pendingReasoning = []

  const timeOf = (record) => {
    const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN
    if (!Number.isFinite(time)) return undefined
    if (firstTime === null || time < firstTime) firstTime = time
    if (time > lastTime) lastTime = time
    return time
  }

  for (const line of lines) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      warnings.push(`${name}: skipped a non-JSON line`)
      continue
    }
    if (record === null || typeof record !== 'object') continue
    const timeMs = timeOf(record)
    const type = record.type
    const payload = record.payload

    if (type === 'session_meta' && payload !== null && typeof payload === 'object') {
      if (typeof payload.cwd === 'string' && cwd === undefined) cwd = payload.cwd
      continue
    }
    if (type === 'turn_context' && payload !== null && typeof payload === 'object') {
      if (typeof payload.model === 'string' && payload.model.length > 0) currentModel = payload.model
      continue
    }
    if (type !== 'response_item' || payload === null || typeof payload !== 'object') continue

    if (payload.type === 'reasoning') {
      const summary = Array.isArray(payload.summary) ? payload.summary : []
      const texts = summary
        .map((item) => (item !== null && typeof item === 'object' && typeof item.text === 'string'
          ? item.text
          : undefined))
        .filter((text) => text !== undefined && text.length > 0)
      if (texts.length > 0) pendingReasoning.push(...texts.map((text) => ({ type: 'reasoning', text })))
      continue
    }
    if (payload.type !== 'message') {
      skippedToolItems += 1 // function_call, local_shell_call, web_search_call, …
      continue
    }
    const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null
    if (role === null) continue
    const contentItems = Array.isArray(payload.content) ? payload.content : []
    const blocks = []
    for (const item of contentItems) {
      if (item !== null && typeof item === 'object'
        && (item.type === 'input_text' || item.type === 'output_text')
        && typeof item.text === 'string' && item.text.length > 0) {
        blocks.push({ type: 'text', text: item.text })
      }
    }
    if (role === 'user') {
      const kept = compactBlocks(blocks)
      if (kept === null) continue
      pendingReasoning = []
      turns.push({ user: utterance('user', kept, { time: timeMs }), assistants: [] })
      continue
    }
    const kept = compactBlocks([...pendingReasoning, ...blocks])
    pendingReasoning = []
    if (kept === null) continue
    models.add(currentModel)
    const turn = turns.at(-1) ?? { user: null, assistants: [] }
    if (turns.length === 0) turns.push(turn)
    turn.assistants.push(utterance('assistant', kept, {
      model: { provider: 'codex', model: currentModel },
      time: timeMs,
    }))
  }

  return {
    format: 'codex',
    sourceAgent: 'Codex',
    turns,
    models: [...models],
    cwd,
    firstTime,
    lastTime,
    skippedToolItems,
    warnings,
  }
}

/* -------------------------------------------------------------------------- */
/* format: generic OpenAI-style message array                                  */

function parseOpenAiMessages(name, parsed) {
  const list = Array.isArray(parsed) ? parsed
    : (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.messages) ? parsed.messages : null)
  if (list === null) {
    throw new Error(`${name}: not a recognizable session export (expected a JSONL transcript or a message array)`)
  }
  const turns = []
  const warnings = []
  let skippedToolItems = 0

  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const role = item.role
    const rawContent = item.content
    const blocks = []
    if (typeof rawContent === 'string') {
      blocks.push({ type: 'text', text: rawContent })
    } else if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (block !== null && typeof block === 'object' && typeof block.text === 'string') {
          blocks.push({ type: 'text', text: block.text })
        } else {
          skippedToolItems += 1
        }
      }
    }
    const kept = compactBlocks(blocks)
    if (kept === null) continue
    if (role === 'user') {
      turns.push({ user: utterance('user', kept), assistants: [] })
    } else if (role === 'assistant') {
      const modelName = typeof item.model === 'string' && item.model.length > 0 ? item.model : 'unknown'
      const turn = turns.at(-1) ?? { user: null, assistants: [] }
      if (turns.length === 0) turns.push(turn)
      turn.assistants.push(utterance('assistant', kept, {
        model: { provider: 'openai-export', model: modelName },
      }))
    } else if (role !== 'system') {
      warnings.push(`${name}: skipped a "${String(role)}" message`)
    }
  }

  return {
    format: 'openai',
    sourceAgent: 'OpenAI-style export',
    turns,
    models: [],
    cwd: undefined,
    firstTime: null,
    lastTime: null,
    skippedToolItems,
    warnings,
  }
}

/* -------------------------------------------------------------------------- */
/* detection                                                                   */

function parseSource(name, text) {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error(`${name}: file is empty`)

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const looksLikeJsonl = lines.length > 1 && lines.every((line) => line.trimStart().startsWith('{'))
  if (looksLikeJsonl) {
    let codexLines = 0
    let claudeLines = 0
    for (const line of lines.slice(0, 50)) {
      try {
        const record = JSON.parse(line)
        if (record === null || typeof record !== 'object') continue
        if (record.type === 'response_item' || record.type === 'session_meta' || record.type === 'turn_context') {
          codexLines += 1
        }
        if ((record.type === 'user' || record.type === 'assistant') && typeof record.message === 'object') {
          claudeLines += 1
        }
      } catch {
        /* tolerate probe failures; the parser reports real errors */
      }
    }
    if (codexLines > 0 && codexLines >= claudeLines) return parseCodex(name, lines)
    if (claudeLines > 0) return parseClaudeCode(name, lines)
  }

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new Error(`${name}: cannot parse as JSON or JSONL (${error instanceof Error ? error.message : String(error)})`)
  }
  return parseOpenAiMessages(name, parsed)
}

/* -------------------------------------------------------------------------- */
/* DSH event generation                                                        */

function buildEvents(conversation) {
  const events = []
  const createdAt = conversation.firstTime ?? Date.now()
  let seq = 0
  const push = (type, data, time, extra = {}) => {
    events.push({ type, seq, time, data, ...extra })
    seq += 1
  }

  let lastModelKey = null
  let turnNumber = 0
  let userMessages = 0
  let assistantMessages = 0
  let firstUserSeq = undefined
  let firstUserText = undefined

  for (const turn of conversation.turns) {
    turnNumber += 1
    const turnTime = turn.user?.time ?? turn.assistants[0]?.time ?? createdAt
    push('turn/start', { turn: turnNumber }, turnTime)
    if (turn.user !== null) {
      userMessages += 1
      if (firstUserText === undefined) {
        firstUserSeq = seq
        const textBlock = turn.user.blocks.find((block) => block.type === 'text')
        firstUserText = textBlock !== undefined ? textBlock.text : ''
      }
      push('user/message', {
        id: crypto.randomUUID(),
        role: 'user',
        content: turn.user.blocks,
        source: { kind: 'user' },
      }, turn.user.time ?? turnTime, { surfaceOp: 'append' })
    }
    let stepNumber = 0
    for (const assistant of turn.assistants) {
      stepNumber += 1
      const stepTime = assistant.time ?? turnTime
      push('step/start', { turn: turnNumber, step: stepNumber }, stepTime)
      if (assistant.model !== undefined) {
        const key = `${assistant.model.provider}:${assistant.model.model}`
        if (key !== lastModelKey) {
          lastModelKey = key
          push('request/context', {
            provider: assistant.model.provider,
            model: assistant.model.model,
          }, stepTime)
        }
      }
      assistantMessages += 1
      push('assistant/message', {
        turn: turnNumber,
        step: stepNumber,
        message: {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: assistant.blocks,
          source: {
            kind: 'model',
            provider: assistant.model?.provider ?? 'imported',
            model: assistant.model?.model ?? 'unknown',
          },
        },
        stream: streamRecordsFor(assistant.blocks, stepTime),
        ...(assistant.usage !== undefined ? { usage: assistant.usage } : {}),
      }, stepTime, { surfaceOp: 'append' })
      push('step/end', { turn: turnNumber, step: stepNumber }, stepTime)
    }
    push('turn/end', { turn: turnNumber, reason: { kind: 'completed' } }, turn.assistants.at(-1)?.time ?? turnTime)
  }

  // Name the session after the conversation's first sentence: a log-only
  // `session/title` event the title service folds latest-wins. The `user`
  // source pins the name — later messages will not trigger auto-retitling.
  const title = firstSentenceTitle(firstUserText ?? '')
  if (title !== null && firstUserSeq !== undefined) {
    push('session/title', {
      title,
      messageSeqs: [firstUserSeq],
      source: { kind: 'user' },
    }, events.at(-1)?.time ?? createdAt)
  }

  return { events, createdAt, counts: { turns: turnNumber, userMessages, assistantMessages } }
}

function previewOf(name, conversation) {
  const built = buildEvents(conversation)
  return {
    name,
    format: conversation.format,
    sourceAgent: conversation.sourceAgent,
    title: titleOf(conversation.turns) ?? name,
    cwd: conversation.cwd ?? null,
    models: conversation.models,
    firstTime: conversation.firstTime,
    lastTime: conversation.lastTime,
    turns: built.counts.turns,
    userMessages: built.counts.userMessages,
    assistantMessages: built.counts.assistantMessages,
    events: built.events.length,
    skippedToolItems: conversation.skippedToolItems,
    warnings: conversation.warnings,
  }
}

/* -------------------------------------------------------------------------- */
/* discovery: other-agent transcript indexes                                   */

const realPath = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Normalize a directory path for workspace comparison. */
function normalizeCwd(p) {
  if (typeof p !== 'string' || p.length === 0) return null
  return realPath(p).replace(/\/+$/, '')
}

/** Read a text file capped at PREVIEW_READ_BYTES. */
async function readCapped(path) {
  const buffer = await readFile(path)
  return buffer.subarray(0, PREVIEW_READ_BYTES).toString('utf8')
}

/** Split capped text into complete JSON lines (drop the torn tail). */
function cappedLines(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (text.length >= PREVIEW_READ_BYTES && lines.length > 0) lines.pop()
  return lines
}

/** Index one Claude Code transcript file. */
async function indexClaudeFile(path, stats) {
  const text = await readCapped(path)
  let cwd = undefined
  let firstTime = null
  let lastTime = null
  let userMessages = 0
  let assistantMessages = 0
  let title = null
  for (const line of cappedLines(text)) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record === null || typeof record !== 'object') continue
    if (typeof record.cwd === 'string' && cwd === undefined) cwd = record.cwd
    const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN
    if (Number.isFinite(time)) {
      if (firstTime === null || time < firstTime) firstTime = time
      if (time > lastTime) lastTime = time
    }
    if (title === null && record.type === 'summary' && typeof record.summary === 'string'
      && record.summary.length > 0) {
      title = record.summary
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue
    if (record.isMeta === true) continue
    if (record.type === 'user') {
      if (typeof record.message?.content === 'string' && title === null) {
        title = record.message.content.replace(/\s+/g, ' ').trim().slice(0, 80) || null
      } else if (title === null && Array.isArray(record.message?.content)) {
        const first = record.message.content.find((b) => b?.type === 'text' && typeof b.text === 'string')
        if (first !== undefined) title = first.text.replace(/\s+/g, ' ').trim().slice(0, 80) || null
      }
      userMessages += 1
    } else {
      assistantMessages += 1
    }
  }
  if (userMessages + assistantMessages === 0) return null
  return {
    path,
    agent: 'claude-code',
    format: 'claude-code',
    cwd: cwd ?? null,
    title: title ?? basename(path),
    firstTime,
    lastTime,
    userMessages,
    assistantMessages,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

/** Index one Codex rollout file. */
async function indexCodexFile(path, stats) {
  const text = await readCapped(path)
  let cwd = undefined
  let firstTime = null
  let lastTime = null
  let userMessages = 0
  let assistantMessages = 0
  let title = null
  for (const line of cappedLines(text)) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record === null || typeof record !== 'object') continue
    const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN
    if (Number.isFinite(time)) {
      if (firstTime === null || time < firstTime) firstTime = time
      if (time > lastTime) lastTime = time
    }
    const payload = record.payload
    if (record.type === 'session_meta' && payload !== null && typeof payload === 'object') {
      if (typeof payload.cwd === 'string' && cwd === undefined) cwd = payload.cwd
      continue
    }
    if (record.type !== 'response_item' || payload === null || typeof payload !== 'object') continue
    if (payload.type !== 'message') continue
    const isUser = payload.role === 'user'
    if (isUser) {
      userMessages += 1
      if (title === null && Array.isArray(payload.content)) {
        const first = payload.content.find((b) => b?.type === 'input_text' && typeof b.text === 'string')
        if (first !== undefined) title = first.text.replace(/\s+/g, ' ').trim().slice(0, 80) || null
      }
    } else if (payload.role === 'assistant') {
      assistantMessages += 1
    }
  }
  if (userMessages + assistantMessages === 0) return null
  return {
    path,
    agent: 'codex',
    format: 'codex',
    cwd: cwd ?? null,
    title: title ?? basename(path),
    firstTime,
    lastTime,
    userMessages,
    assistantMessages,
    sizeBytes: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

/** List Claude Code transcript files under ~/.claude/projects. */
async function claudeFiles() {
  const root = join(homedir(), '.claude', 'projects')
  if (!existsSync(root)) return []
  const out = []
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const projectDir = join(root, dir.name)
    for (const file of await readdir(projectDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
      out.push(join(projectDir, file.name))
      if (out.length >= MAX_FILES_PER_AGENT) return out
    }
  }
  return out
}

/** List Codex rollout files under ~/.codex/sessions (YYYY/MM/DD layout). */
async function codexFiles() {
  const root = join(homedir(), '.codex', 'sessions')
  if (!existsSync(root)) return []
  const out = []
  const years = await readdir(root, { withFileTypes: true })
  for (const year of years) {
    if (!year.isDirectory()) continue
    const months = await readdir(join(root, year.name), { withFileTypes: true }).catch(() => [])
    for (const month of months) {
      if (!month.isDirectory()) continue
      const days = await readdir(join(root, year.name, month.name), { withFileTypes: true }).catch(() => [])
      for (const day of days) {
        if (!day.isDirectory()) continue
        const files = await readdir(join(root, year.name, month.name, day.name), { withFileTypes: true })
          .catch(() => [])
        for (const file of files) {
          if (!file.isFile() || !file.name.startsWith('rollout-') || !file.name.endsWith('.jsonl')) continue
          out.push(join(root, year.name, month.name, day.name, file.name))
          if (out.length >= MAX_FILES_PER_AGENT) return out
        }
      }
    }
  }
  return out
}

/**
 * Scan every other-agent transcript on this machine.
 * @param {string | undefined} currentCwd - normalized current workspace path.
 * @returns {Promise<object[]>} discovered session entries.
 */
async function discoverSessions(currentCwd) {
  const entries = []
  const scan = async (files, indexer) => {
    for (const path of files) {
      try {
        const stats = await stat(path)
        const entry = await indexer(path, stats)
        if (entry !== null) entries.push(entry)
      } catch {
        /* unreadable file: skip */
      }
    }
  }
  await scan(await claudeFiles(), indexClaudeFile)
  await scan(await codexFiles(), indexCodexFile)

  for (const entry of entries) {
    entry.cwdNormalized = normalizeCwd(entry.cwd)
    entry.matchesCurrentWorkspace = currentCwd !== null && entry.cwdNormalized === currentCwd
  }
  entries.sort((a, b) => Number(b.matchesCurrentWorkspace) - Number(a.matchesCurrentWorkspace)
    || (b.lastTime ?? b.mtimeMs) - (a.lastTime ?? a.mtimeMs))
  return entries.slice(0, MAX_DISCOVER_RESULTS)
}

/** Whether a path sits inside one of the scanned agent roots. */
function isAgentTranscript(path) {
  const real = realPath(path)
  for (const root of [join(homedir(), '.claude'), join(homedir(), '.codex')]) {
    const realRoot = realPath(root)
    if (real.startsWith(`${realRoot}/`)) return true
  }
  return false
}

/* -------------------------------------------------------------------------- */
/* plugin body                                                                 */

/** Read and JSON-parse one request body with a size ceiling. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Implementation entry, mounted by the shim.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 */
export function apply(ctx) {
  const ROUTE = '/plugins/session-import'
  const home = typeof ctx.dshHomePath === 'string' ? ctx.dshHomePath : join(homedir(), '.dsh')
  const storeDir = join(home, 'plugins', 'dsh-plugin-session-import')
  const storePath = join(storeDir, 'imports.json')

  /**
   * Archived session ids from the workspace registry, guarded: accessing an
   * undeclared service throws in cordis, and this impl may run under an older
   * shim whose inject list predates the workspaceRegistry dependency — until
   * that shim reloads (one restart), archive sync simply reports nothing.
   */
  const readArchivedIds = () => {
    try {
      return new Set([...(ctx.workspaceRegistry?.archivedSessionIds ?? [])].map(String))
    } catch {
      return new Set()
    }
  }

  /** Load the imported-sources ledger (source path -> dsh session). */
  const loadLedger = () => {
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8'))
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const saveLedger = async (ledger) => {
    await mkdir(storeDir, { recursive: true })
    await writeFile(storePath, JSON.stringify(ledger, null, 2), 'utf8')
  }

  /**
   * Best-effort workspace membership for a freshly imported session: resolve
   * (or register) the workspace at the transcript's cwd, then attach the
   * session so it lands under that workspace immediately instead of the
   * ungrouped bucket. A missing registry service or a deleted directory
   * degrades to `{ attached: false, warn }` — the session stays imported.
   */
  const attachToWorkspace = async (sessionId, cwd) => {
    if (typeof cwd !== 'string' || cwd.length === 0) return { attached: false }
    try {
      const registry = ctx.workspaceRegistry
      if (registry === undefined) {
        return { attached: false, warn: 'workspaceRegistry service unavailable' }
      }
      let workspace = await registry.resolveByPath(cwd)
      if (workspace === undefined) workspace = await registry.create(cwd)
      await workspace.attachSession(sessionId)
      return { attached: true, path: workspace.path }
    } catch (error) {
      return { attached: false, warn: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Shared import pipeline: conversation description -> persisted session. */
  const importConversation = async (name, conversation) => {
    const built = buildEvents(conversation)
    const sessionId = crypto.randomUUID()
    const meta = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: built.createdAt,
      isSeeded: false,
      ...(conversation.cwd !== undefined ? { cwd: conversation.cwd } : {}),
    }
    // Handle-based write path (dsh >= 0.1.6): create() takes single-writer
    // ownership, so the handle MUST be closed afterwards — otherwise a later
    // resume (open 'write') would reject with SessionAlreadyOwnedError.
    const writer = await ctx.sessionPersistence.create(meta)
    try {
      await writer.append(built.events)
      await writer.flush()
    } finally {
      await writer.close()
    }
    const workspace = await attachToWorkspace(sessionId, conversation.cwd)
    // Read the session back through a read handle — the same cold read path a
    // resume uses; proof at import time that the log loads for continuing.
    let verified = false
    try {
      const reader = await ctx.sessionPersistence.open(sessionId, 'read')
      try {
        verified = (await reader.read()).events.length === built.events.length
      } finally {
        await reader.close().catch(() => {})
      }
    } catch (error) {
      ctx.logger?.('session-import')?.warn(
        `imported session ${sessionId} failed cold read-back: ${String(error)}`)
    }
    return { sessionId, built, title: titleOf(conversation.turns) ?? name, workspace, verified }
  }

  /** Import one discovered transcript file by path. */
  const importFile = async (path) => {
    const real = realPath(path)
    if (!isAgentTranscript(real)) {
      throw new Error('path is not inside a scanned agent directory (~/.claude or ~/.codex)')
    }
    const stats = await stat(real)
    const text = await readFile(real, 'utf8')
    const conversation = parseSource(basename(real), text)
    if (conversation.turns.length === 0) {
      throw new Error(`${basename(real)}: no importable conversation content found`)
    }
    const { sessionId, built, title, workspace, verified } = await importConversation(basename(real), conversation)
    const ledger = loadLedger()
    ledger[real] = { sessionId, importedAt: Date.now(), title, agent: conversation.format }
    await saveLedger(ledger)
    return {
      sessionId,
      title,
      path: real,
      turns: built.counts.turns,
      userMessages: built.counts.userMessages,
      assistantMessages: built.counts.assistantMessages,
      events: built.events.length,
      skippedToolItems: conversation.skippedToolItems,
      warnings: conversation.warnings,
      sizeBytes: stats.size,
      workspace,
      verified,
    }
  }

  /** Route handler. */
  const handler = async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    const reply = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    }
    try {
      if (req.method !== 'POST') {
        reply(405, { error: 'method not allowed' })
        return
      }

      if (pathname === `${ROUTE}/discover`) {
        const body = await readJsonBody(req).catch(() => ({}))
        const currentCwd = normalizeCwd(typeof body?.cwd === 'string' ? body.cwd : undefined)
        let ledger = loadLedger()
        const sessions = await discoverSessions(currentCwd)
        // Liveness of every ledger record: a session deleted in DSH leaves
        // persistence, an archived one stays but is hidden — both mean the
        // source file is importable again. Deleted records are pruned from
        // the ledger; archived ones are kept so unarchiving restores the
        // "imported" badge on the next scan.
        const liveIds = new Set(
          (await ctx.sessionPersistence.list()).map(snap => String(snap.header.id)))
        const archivedIds = readArchivedIds()
        let pruned = false
        for (const key of Object.keys(ledger)) {
          if (!liveIds.has(String(ledger[key].sessionId))) {
            delete ledger[key]
            pruned = true
          }
        }
        if (pruned) {
          await saveLedger(ledger)
          ledger = loadLedger()
        }
        reply(200, {
          currentCwd,
          scanned: {
            claudeCode: await claudeFiles().then(files => files.length).catch(() => 0),
          },
          sessions: sessions.map((entry) => {
            const record = ledger[entry.path]
            const imported = record !== undefined
              && liveIds.has(String(record.sessionId))
              && !archivedIds.has(String(record.sessionId))
              ? record
              : null
            return { ...entry, imported }
          }),
        })
        return
      }

      if (pathname === `${ROUTE}/import-file`) {
        const body = await readJsonBody(req)
        const path = typeof body?.path === 'string' ? body.path : undefined
        if (path === undefined) {
          reply(400, { error: 'body must be { path }' })
          return
        }
        try {
          reply(200, await importFile(path))
        } catch (error) {
          reply(422, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }

      if (pathname === `${ROUTE}/inspect` || pathname === `${ROUTE}/import`) {
        const body = await readJsonBody(req)
        const name = typeof body?.name === 'string' && body.name.length > 0 ? body.name : 'session'
        if (typeof body?.text !== 'string') {
          reply(400, { error: 'body must be { name, text }' })
          return
        }
        const conversation = parseSource(name, body.text)
        if (conversation.turns.length === 0) {
          reply(422, { error: `${name}: no importable conversation content found` })
          return
        }
        if (pathname.endsWith('/inspect')) {
          reply(200, previewOf(name, conversation))
          return
        }
        const { sessionId, built, title, workspace, verified } = await importConversation(name, conversation)
        ctx.logger?.('session-import')?.info(`imported ${name} as session ${sessionId}`)
        reply(200, {
          sessionId,
          title,
          turns: built.counts.turns,
          userMessages: built.counts.userMessages,
          assistantMessages: built.counts.assistantMessages,
          events: built.events.length,
          skippedToolItems: conversation.skippedToolItems,
          warnings: conversation.warnings,
          workspace,
          verified,
          workspace,
        })
        return
      }

      reply(404, { error: 'not found' })
    } catch (error) {
      ctx.logger?.('session-import')?.warn(`request failed: ${String(error)}`)
      reply(500, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }),
    'session-import: routes',
  )
}

/* Exposed for tests and offline tooling; the loader ignores extra exports. */
export { parseSource, buildEvents, previewOf, discoverSessions }
