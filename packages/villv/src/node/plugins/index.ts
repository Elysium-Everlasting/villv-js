/**
 * FIXME: this is kinda circular.
 *
 * plugins -> config
 * this file -> config
 * config -> this file
 */

import type { ObjectHook } from 'rollup'
import type { Plugin } from '../plugin.js'

/**
 * FIXME: this is kinda circular.
 *
 * plugins -> config
 * this file -> config
 * config -> this file
 */
export function getSortedPluginsBy(
  key: keyof Plugin,
  plugins: Plugin[] | readonly Plugin[],
): Plugin[] {
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

export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T

export interface PluginHookUtils {
  getSortedPlugins: (hookName: keyof Plugin) => Plugin[]
  getSortedPluginHooks: <K extends keyof Plugin>(
    hookName: K,
  ) => NonNullable<HookHandler<Plugin[K]>>[]
}

export function createPluginHookUtils(plugins: readonly Plugin[]): PluginHookUtils {
  // sort plugins per hook
  const sortedPluginsCache = new Map<keyof Plugin, Plugin[]>()

  function getSortedPlugins(hookName: keyof Plugin): Plugin[] {
    if (sortedPluginsCache.has(hookName)) {
      const sortedPlugins = sortedPluginsCache.get(hookName)

      if (sortedPlugins != null) {
        return sortedPlugins
      }
    }

    const sorted = getSortedPluginsBy(hookName, plugins)

    sortedPluginsCache.set(hookName, sorted)

    return sorted
  }

  function getSortedPluginHooks<K extends keyof Plugin>(
    hookName: K,
  ): NonNullable<HookHandler<Plugin[K]>>[] {
    const plugins = getSortedPlugins(hookName)

    return plugins
      .map((p) => {
        const hook = p[hookName]!
        return typeof hook === 'object' && 'handler' in hook ? hook.handler : hook
      })
      .filter(Boolean)
  }

  return {
    getSortedPlugins,
    getSortedPluginHooks,
  }
}
