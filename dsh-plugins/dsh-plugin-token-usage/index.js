/**
 * dsh-plugin-token-usage — host shim.
 *
 * Thin mounting layer (same pattern as dsh-plugin-session-import): the
 * loader imports this file once per process, and apply() dynamically imports
 * the implementation with a cache-busting `?rev=` query taken from the entry
 * config — bump `implRev` in cordis.patch.yml to hot-reload the host half:
 *
 * ```yaml
 * - insert:
 *     - id: plugin-token-usage
 *       name: dsh-plugin-token-usage
 *       config: { implRev: 2 }
 * ```
 */

export const name = 'dsh-plugin-token-usage'

/** Host services required before this plugin activates. */
export const inject = ['webServer', 'sessionPersistence']

/**
 * Mount the implementation.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @param {{ implRev?: number } | undefined} config - entry config.
 * @returns {Promise<void>} resolution once the implementation registered.
 */
export function apply(ctx, config) {
  const rev = typeof config?.implRev === 'number' && Number.isFinite(config.implRev)
    ? config.implRev
    : 1
  return import(`./impl.js?rev=${rev}`).then(impl => impl.apply(ctx))
}
