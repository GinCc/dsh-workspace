/**
 * dsh-plugin-token-usage — host implementation.
 *
 * Aggregates token usage over every persisted session log and serves the
 * folded result as JSON at `GET /plugins/token-usage/stats`. Per-session
 * folds are cached keyed on the persistence snapshot revision, so repeated
 * openings re-read only sessions whose stored log changed.
 *
 * No runtime dependencies: everything arrives through ctx services
 * (`webServer`, `sessionPersistence`) and the events themselves carry usage
 * (`assistant/message` events) and provider/model identity (the assistant
 * message `source`).
 */

/** Implementation entry, mounted by the shim. */
export function apply(ctx) {
  /** @type {Map<string, {revision: unknown, row: object}>} per-session fold cache. */
  const cache = new Map()

  /**
   * Fold one session log into a stats row.
   * @param {object} header - session metadata.
   * @param {readonly any[]} events - the full stored event log.
   * @returns {object} the per-session row served to the client.
   */
  function foldSession(header, events) {
    const row = {
      id: String(header.id),
      createdAt: header.createdAt,
      cwd: header.cwd ?? null,
      turns: 0,
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      models: {},
      firstTime: null,
      lastTime: null,
    }
    for (const event of events) {
      if (typeof event?.time === 'number') {
        if (row.firstTime === null || event.time < row.firstTime) row.firstTime = event.time
        if (event.time > row.lastTime) row.lastTime = event.time
      }
      switch (event.type) {
        case 'turn/end':
          row.turns += 1
          break
        case 'step/end':
          row.steps += 1
          break
        case 'assistant/message': {
          const source = event.data?.message?.source
          if (source?.kind !== 'model') break
          const key = `${source.provider}:${source.model}`
          const model = row.models[key] ??= {
            provider: source.provider,
            model: source.model,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          }
          model.calls += 1
          const usage = event.data.usage
          if (usage === undefined) break
          for (const bucket of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
            const value = typeof usage[bucket] === 'number' && Number.isFinite(usage[bucket])
              ? usage[bucket]
              : 0
            row[bucket] += value
            model[bucket] += value
          }
          break
        }
        default:
          break
      }
    }
    return row
  }

  /** Sum cache buckets into the billed-input figure shared by the UI. */
  function billedInput(row) {
    return row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens
  }

  /**
   * Scan every persisted session and fold usage rows.
   * @returns {Promise<object>} the stats payload.
   */
  async function computeStats() {
    const snapshots = await ctx.sessionPersistence.list()
    const sessions = []
    for (const snapshot of snapshots.slice(0, 5000)) {
      const id = String(snapshot.header.id)
      let cached = cache.get(id)
      if (cached === undefined || cached.revision !== snapshot.revision) {
        try {
          // Handle-based read (dsh >= 0.1.6): a read handle observes the log
          // without ownership; always closed so backends can free resources.
          const reader = await ctx.sessionPersistence.open(id, 'read')
          let events
          try {
            ;({ events } = await reader.read())
          } finally {
            await reader.close().catch(() => {})
          }
          cached = { revision: snapshot.revision, row: foldSession(snapshot.header, events) }
          cache.set(id, cached)
        } catch (error) {
          ctx.logger?.('token-usage')?.warn(`failed to read session ${id}: ${String(error)}`)
          continue
        }
      }
      sessions.push(cached.row)
    }
    sessions.sort((a, b) => billedInput(b) - billedInput(a) || b.outputTokens - a.outputTokens)

    const totals = {
      sessions: sessions.length,
      turns: 0,
      steps: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    const models = new Map()
    for (const row of sessions) {
      totals.turns += row.turns
      totals.steps += row.steps
      for (const bucket of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
        totals[bucket] += row[bucket]
      }
      for (const [key, model] of Object.entries(row.models)) {
        const merged = models.get(key) ?? {
          provider: model.provider,
          model: model.model,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          sessions: 0,
        }
        merged.calls += model.calls
        for (const bucket of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
          merged[bucket] += model[bucket]
        }
        merged.sessions += 1
        models.set(key, merged)
      }
    }
    const byModel = [...models.values()].sort(
      (a, b) => (billedInput(b) + b.outputTokens) - (billedInput(a) + a.outputTokens),
    )
    return { generatedAt: Date.now(), totals, byModel, sessions }
  }

  /**
   * The route handler: exact `GET /plugins/token-usage/stats`.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   */
  const handler = async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    if (pathname !== '/plugins/token-usage/stats') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    try {
      const payload = await computeStats()
      const body = JSON.stringify(payload)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch (error) {
      ctx.logger?.('token-usage')?.warn(`stats failed: ${String(error)}`)
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/plugins/token-usage', handler }),
    'token-usage: stats route',
  )
}
