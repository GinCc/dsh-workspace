/**
 * dsh-plugin-session-import — host shim.
 *
 * Thin mounting layer: the loader only ever imports this file once per
 * process, so hot iteration happens one level down — apply() dynamically
 * imports the implementation with a cache-busting `?rev=` query taken from
 * the entry config. Bumping `implRev` in cordis.patch.yml reloads the host
 * half without restarting dsh:
 *
 * ```yaml
 * - insert:
 *     - id: plugin-session-import
 *       name: dsh-plugin-session-import
 *       config: { implRev: 2 }
 * ```
 */

export const name = 'dsh-plugin-session-import'

/** Host services required before this plugin activates. */
export const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry']

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
