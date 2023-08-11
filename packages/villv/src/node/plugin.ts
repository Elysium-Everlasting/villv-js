/**
 * @warning
 *
 * This file is circular because it imports from `config.ts` and `config.ts` imports from this file.
 */

import type { UserConfig, ConfigEnv, ResolvedConfig, Command } from './config.js'
import type { Plugin as RollupPlugin, PluginHooks, ObjectHook } from 'rollup'

/**
 * Vite plugins extend Rollup's plugin API with some additional Vite-specific options.
 *
 * A valid Vite plugin is also a valid Rollup plugin, but the reverse is not necessarily true;
 * this is because some Rollup features do not make sense in the context of
 * an unbundled development server. Generally, as long as a Rollup plugin doesn't have
 * strong coupling between its bundle phase and output phase hooks, then it should
 * just work :tm: (i.e. most of them).
 *
 * ABy default, the plugins are run during __both__ development and build phases.
 * When a plugin is applied during development, it will only run __non output plugin hooks__
 * See Rollup's type definition of {@link PluginHooks} for more details.
 *
 * You can think of the development server as only running `const bundle = rollup.rollup()`,
 * but never calling `bundle.generate()` or `bundle.write()`.
 *
 * A plugin that expects to have different behaviors depending on whether
 * it's currently a development or build phase can export a factory function
 * that receives the current command being run.
 *
 * If a plugin should only be applied exclusively for either phase,
 * a function format config file can be used to conditionally determine the plugins to use.
 */
export interface Plugin extends RollupPlugin {
  /**
   * Enforce plugin invocation tier similar to webpack loaders.
   *
   * Plugin invocation order:
   *
   * - alias resolution
   * - enforce = 'pre' plugins
   * - core plugins
   * - normal plugins
   * - enforce = 'post' plugins
   * - post build plugins
   */
  enforce?: PluginOrder

  /**
   * Apply the plugin only for serve or build, or on certain conditions.
   */
  apply?: Command | ((this: void, config: UserConfig, env: ConfigEnv) => void)

  /**
   * Modify the root config before it's resolved. The hook can either mutate the config
   * that's passed to the function, or return a partial config object that will
   * be deeply merged into the existing config.
   *
   * @remarks User plugins are resolved __before__ running this hook,
   * so injecting other plugins inside the {@link config} hook will have no effect.
   *
   * TODO
   */
  config?: ObjectHook<
    (
      this: void,
      config: UserConfig,
      env: ConfigEnv,
    ) => UserConfig | null | void | Promise<UserConfig | null | void>
  >

  /**
   * Use this hook to read and store the final resolved config.
   *
   * TODO
   */
  configResolved?: ObjectHook<(this: void, config: ResolvedConfig) => void | Promise<void>>

  /**
   * Configure the development server.
   *
   * This hook receives the {@link DevelopmentServer} instance.
   * This can also be used to store a reference to the server for use in other hooks.
   *
   * This hook will be called __before__ internal middlewares are applied.
   * A hook can return a `post` hook that will be called __after__ the internal middlewares
   * are applied. Hooks can be async functions and will be called in order.
   *
   * TODO
   */
  configureServer?: ObjectHook<any>

  /**
   * TODO
   */
  configurePreviewServer?: ObjectHook<any>

  /**
   * TODO
   */
  transformIndexHtml?: ObjectHook<any>

  /**
   * TODO
   */
  handleHotUpdate?: ObjectHook<any>

  /**
   * TODO
   */
  resolveId?: ObjectHook<any>

  /**
   * TODO
   */
  load?: ObjectHook<any>

  /**
   * TODO
   */
  transform?: ObjectHook<any>
}

export type PluginOrder = 'pre' | 'post'
