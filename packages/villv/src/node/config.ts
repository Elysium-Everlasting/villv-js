import type { BuildOptions as ESBuildOptions } from 'esbuild'
import type { RollupOptions } from 'rollup'
import type { RollupAliasOptions } from '@rollup/plugin-alias'
import type { Plugin } from './plugin.js'
import type { LogLevel, Logger } from './logger.js'
import type { ResolveOptions } from './plugins/resolve.js'
import type { CssOptions } from './plugins/css.js'
import type { JsonOptions } from './plugins/json.js'
import type { ServerOptions } from './server/index.js'
import type { BuildOptions } from './server/build.js'

export interface UserConfig {
  /**
   * Path to project root directory.
   *
   * Can be absolute or relative from the config file's location.
   *
   * @default process.cwd()
   */
  root?: string

  /**
   * Base public path for serving the application.
   *
   * @default '/'
   */
  base?: string

  /**
   * Directory to serve plain static assets from.
   *
   * Files in this directory are served and copied to the build output directory as-is,
   * i.e. without any transformations.
   *
   * Can be an absolute path or a path relative to {@link root}.
   *
   * Can be set to `false` or an empty string to disable copying
   * static assets to the build output directory.
   *
   * @default 'public'
   */
  publicDirectory?: string | false

  /**
   * Directory to save cached files.
   *
   * Can be an absolute file path or a path relative to {@link root}.
   *
   * Files in this directory are pre-bundled dependencies or other generated cache files,
   * which are used to improve performance.
   *
   * You can use the `--force` flag or manually delete the directory to regenerate the
   * cached files.
   *
   * @default 'node_modules/.vite'
   */
  cacheDirectory?: string

  /**
   * Explicitly set a mode to run in.
   *
   * This overrides the default mode for each command, and can be overridden by
   * the command line `--mode` options.
   *
   * @default (per command)
   *
   * TODO
   */
  mode?: string

  /**
   * Define global variable replacements.
   *
   * Entries will be defined on {@link window} during development,
   * and with ESBuild's [define](https://esbuild.github.io/api/#define) API during build.
   */
  define?: Record<string, any>

  /**
   * Array of plugins to use.
   */
  plugins?: PluginOption[]

  /**
   * Configure the resolver.
   *
   * What's a resolver?
   */
  resolve?: ResolveOptions & { alias?: RollupAliasOptions }

  /**
   * CSS options.
   *
   * i.e. for pre-processors, CSS modules, etc.
   */
  css?: CssOptions

  /**
   * JSON options.
   *
   * i.e. Idk.
   */
  json?: JsonOptions

  /**
   * Directlry override ESBuild's [transform](https://esbuild.github.io/api/#transform).
   *
   * Set to `false` to disable using ESBuild, i.e. in favor of SWC.
   */
  esbuild: ESBuildOptions | false

  /**
   * Specify additional glob patterns to be treated as static assets.
   *
   * Patterns are resolved by [picomatch](https://github.com/micromatch/picomatch)
   */
  assetsInclude?: string | RegExp | (string | RegExp)[]

  /**
   * Configure the development server.
   *
   * i.e. host, port, protocol, etc.
   *
   * TODO
   */
  server?: ServerOptions

  /**
   * Configure the build procedure.
   *
   * TODO
   */
  build?: BuildOptions

  /**
   * Configure the preview server.
   *
   * i.e. host, port, protocol, etc.
   *
   * TODO
   */
  preview?: any // PreviewOptions

  /**
   * Dependency optimization options.
   *
   * TODO
   */
  optimizeDependencies?: any // DepOptimizationOptions

  /**
   * Configure SSR procedures.
   *
   * i.e. custom rendering logic based on the request, etc.
   *
   * TODO
   */
  ssr?: any // SSROptions

  /**
   * Experimental features.
   *
   * Features under this field could change in the future __without adheing to semver__!!
   * Please be careful when using these features, and ensure that this package's version is pinned.
   *
   * @experimental
   */
  experimental?: any // ExperimentalOptions

  /**
   * Legacy options.
   *
   * Features under this field __will follow semver for patches__.
   * However, they can be removed in a future minor version; ensure that this package's version is pinned.
   *
   * @legacy
   */
  legacy?: any // LegacyOptions

  /**
   * Log level.
   *
   * @default 'info'
   */
  logLevel?: LogLevel

  /**
   * Set a custom logger.
   */
  logger: Logger

  /**
   * Whether the screen can be cleared.
   *
   * e.g. after starting the development server, the screen can be cleared before printing the URLs.
   *
   * @default true
   */
  clearScreen?: boolean

  /**
   * Directory to find environment files.
   *
   * Can be an absolute file path or a path relative from {@link root}
   *
   * @default root
   */
  envDirectory?: string

  /**
   * Environment variables that start with the designated prefix will be exposed
   * to client source code via `import.meta.url`
   *
   * @default 'VITE_'
   */
  envPrefix?: string | string[]

  /**
   * Worker bundle options.
   */
  worker?: WorkerBundleOptions

  /**
   * Whether your application is a:
   * - Single Page Application (SPA)
   * - Multi-Page Application (MPA)
   * - Custom Application (SSR and frameworks with custom HTML handling)
   *
   *   @default 'spa'
   */
  appType?: AppType
}

/**
 * What's a worker bundle? How is it different from the other bundle?
 */
export interface WorkerBundleOptions {
  /**
   * Output format for the worker bundle.
   *
   * @default 'iife'
   */
  format?: 'es' | 'iife'

  /**
   * Plugins that only apply to the worker bundle.
   *
   * TODO
   */
  plugins?: any // PluginOption[]

  /**
   * Rollup options to build the worker bundle.
   */
  rollupOptions?: Omit<RollupOptions, 'plugins' | 'input' | 'onwarn' | 'preserveEntrySignatures'>

  // Does the worker bundle not use ESBuild at all?
}

export interface ResolvedConfig extends UserConfig {}

export interface ConfigEnv {
  /**
   * The command being executed.
   */
  command: Command

  /**
   * The mode being used.
   */
  mode: string

  /**
   * @experimental
   */
  ssrBuild?: boolean
}

export type PluginOption =
  | Plugin
  | false
  | null
  | undefined
  | PluginOption[]
  | Promise<Plugin | false | null | undefined | PluginOption[]>

export type Command = 'build' | 'serve'

/**
 * spa: include SPA fallback middleware and configure sirv with `single: true` in preview
 *
 * mpa: only include non-SPA HTML middlewares
 *
 * custom: don't include HTML middlewares
 */
export type AppType = 'spa' | 'mpa' | 'custom'
