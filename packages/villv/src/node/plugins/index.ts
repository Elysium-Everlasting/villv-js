/**
 * FIXME: this is kinda circular.
 *
 * plugins -> config
 * this file -> config
 * config -> this file
 */

import type { Plugin } from '../plugin.js'

/**
 * FIXME: this is kinda circular.
 *
 * plugins -> config
 * this file -> config
 * config -> this file
 */
export function getSortedPluginsBy(key: keyof Plugin, plugins: Plugin[]): Plugin[] {
  const pluginHooks = plugins
    .map((plugin) => ({ plugin, hook: plugin[key] }))
    .filter(({ hook }) => hook != null)

  const pre = pluginHooks
    .filter(({ hook }) => typeof hook === 'object' && hook.order === 'pre')
    .map(({ plugin }) => plugin)

  const post = pluginHooks
    .filter(({ hook }) => typeof hook === 'object' && hook.order === 'post')
    .map(({ plugin }) => plugin)

  const normal = pluginHooks
    .filter(({ hook }) => typeof hook !== 'object')
    .map(({ plugin }) => plugin)

  return [...pre, ...normal, ...post]
}
