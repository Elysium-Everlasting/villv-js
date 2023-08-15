import fs from 'node:fs'
import path from 'node:path'
import colors from 'picocolors'
import { createRequire } from 'node:module'
import { build, type BuildOptions as ESBuildOptions } from 'esbuild'
import type { ObjectHook, RollupOptions } from 'rollup'
import aliasPlugin, { type RollupAliasOptions } from '@rollup/plugin-alias'
import type { Plugin } from './plugin.js'
import { createLogger, type LogLevel, type Logger } from './logger.js'
import { tryNodeResolve, type ResolveOptions, resolvePlugin } from './plugins/resolve.js'
import { resolveCSSOptions, type CSSOptions } from './plugins/css.js'
import type { JsonOptions } from './plugins/json.js'
import type { ServerOptions } from './server/index.js'
import type { BuildOptions } from './server/build.js'
import { findNearestPackageData, type PackageCache } from './packages.js'
import {
  CLIENT_ENTRY,
  DEFAULT_ASSETS_REGEX,
  DEFAULT_CONFIG_FILES,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  ENV_ENTRY,
  FS_PREFIX,
} from './constants.js'
import {
  asyncFlatten,
  createDebugger,
  createFilter,
  dynamicImport,
  isBuiltin,
  isExternalUrl,
  isObject,
  lookupFile,
  mergeAlias,
  mergeConfig,
  normalizeAlias,
  normalizePath,
} from './utils.js'
import { promisify } from 'util'
import { pathToFileURL } from 'node:url'
import { getSortedPluginsBy } from './plugins/index.js'
import { loadEnv, resolveEnvPrefix } from './env.js'
import { resolveBuildOptions } from './build.js'
import { createPluginContainer, type PluginContainer } from './server/plugin-container.js'
import { resolveSSROptions } from './ssr/index.js'
import { resolvePreviewOptions } from './preview.js'

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
  resolve?: ResolveOptions & { alias?: RollupAliasOptions['entries'] }

  /**
   * CSS options.
   *
   * i.e. for pre-processors, CSS modules, etc.
   */
  css?: CSSOptions

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

type InternalConfig = {
  configFile: string | undefined

  configFileDependencies: string[]

  inlineConfig: InlineConfig

  root: string

  base: string

  /**
   * @internal
   */
  rawBase: string

  publicDir: string

  cacheDir: string

  command: Command

  mode: string

  isWorker: boolean

  /**
   * In nested worker bundle to find the main config.
   * @internal
   */
  mainConfig: ResolvedConfig | null

  isProduction: boolean

  envDir: string

  env: Record<string, any>

  resolve: Required<ResolveOptions> & { alias: RollupAliasOptions['entries'] }

  plugins: readonly Plugin[]

  /**
   * TODO
   */
  css: any // ResolvedCSSOptions | undefined

  esbuild: ESBuildOptions | false

  /**
   * TODO
   */
  server: any // ResolvedServerOptions

  /**
   * TODO
   */
  build: any // ResolvedBuildOptions

  /**
   * TODO
   */
  preview: any // ResolvedPreviewOptions

  /**
   * TODO
   */
  ssr: any // ResolvedSSROptions

  assetsInclude: (file: string) => boolean

  logger: Logger

  /**
   * TODO
   */
  createResolver: any // (options?: Partial<InternalResolveOptions>) => ResolveFn

  /**
   * TODO
   */
  optimizeDeps: any // DepOptimizationOptions

  /**
   * @internal
   *
   * TODO
   */
  packageCache: any // PackageCache

  /**
   * TODO
   */
  worker: any // ResolveWorkerOptions

  appType: AppType

  /**
   * TODO
   */
  experimental: any // ExperimentalOptions
}

/**
 * TODO: move this somewhere else?
 */
export type HookHandler<T> = T extends ObjectHook<infer H> ? H : T

/**
 * TODO
 */
export interface PluginHookUtils {
  getSortedPlugins(hookName: keyof Plugin): Plugin[]
  getSortedPluginHooks<K extends keyof Plugin>(hookName: K): NonNullable<HookHandler<Plugin[K]>>[]
}

type Override<Left, Right> = Omit<Left, keyof Right> & Right

/**
 * TODO
 */
export type ResolvedConfig = Override<UserConfig, InternalConfig & PluginHookUtils>

/**
 * Options that can be specified via the command line.
 */
export interface InlineConfig extends UserConfig {
  /**
   * Path to the config file, or false to disable reading from any config file.
   */
  configFile?: string | false

  /**
   * Disable reading from any env file.
   */
  envFile?: false
}

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

export type UserConfigFnObject = (env: ConfigEnv) => UserConfig
export type UserConfigFnPromise = (env: ConfigEnv) => Promise<UserConfig>
export type UserConfigFn = (env: ConfigEnv) => UserConfig | Promise<UserConfig>

export type UserConfigExport =
  | UserConfig
  | Promise<UserConfig>
  | UserConfigFnObject
  | UserConfigFnPromise
  | UserConfigFn

const debug = createDebugger('vite:config')

const promisifiedRealpath = promisify(fs.realpath)

export async function resolveConfig(
  inlineConfig: InlineConfig,
  command: Command,
  defaultMode = 'development',
  defaultNodeEnv = 'development',
): Promise<ResolvedConfig> {
  let config = inlineConfig
  let configFileDependencies: string[] = []
  let mode = inlineConfig.mode ?? defaultMode

  const isNodeEnvSet = Boolean(process.env['NODE_ENV'])
  const packageCache: PackageCache = new Map()

  // some dependencies e.g. @vue/compiler-* rely on NODE_ENV being set
  // for determining production-specific behavior, so set it early on.
  if (!isNodeEnvSet) {
    process.env['NODE_ENV'] = defaultNodeEnv
  }

  const configEnv: ConfigEnv = {
    mode,
    command,
    ssrBuild: Boolean(config.build?.ssr),
  }

  let { configFile } = config

  if (configFile !== false) {
    await loadConfigFromFile(configEnv, configFile, config.root, config.logLevel).then(
      (loadResult) => {
        if (loadResult) {
          config = mergeConfig(loadResult.config, config)
          configFile = loadResult.path
          configFileDependencies = loadResult.dependencies
        }
      },
    )
  }

  // user config may provide an alternative mode. But --mode has a higher priority
  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode

  const filterPlugin = (plugin: Plugin) => {
    if (!plugin) {
      return false
    } else if (!plugin.apply) {
      return true
    } else if (typeof plugin.apply === 'function') {
      return plugin.apply({ ...config, mode }, configEnv)
    } else {
      return plugin.apply === command
    }
  }

  // Some plugins that aren't intended to work in the bundling of workers (doing post-processing at build time for example).
  // And Plugins may also have cached that could be corrupted by being used in these extra rollup calls.
  // So we need to separate the worker plugin from the plugin that vite needs to run.
  const rawWorkerUserPlugins = await asyncFlatten(config.worker?.plugins ?? []).then((plugins) =>
    (plugins as Plugin[]).filter(filterPlugin),
  )

  // resolve plugins
  const rawUserPlugins = await asyncFlatten(config.plugins ?? []).then((plugins) =>
    (plugins as Plugin[]).filter(filterPlugin),
  )

  const [prePlugins, normalPlugins, postPlugins] = sortUserPlugins(rawUserPlugins)

  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]

  config = await runConfigHook(config, userPlugins, configEnv)

  // If there are custom commonjsOptions, don't force optimized deps for this test
  // even if the env var is set as it would interfere with the playground specs.
  if (!config.build?.commonjsOptions && process.env['VITE_TEST_WITHOUT_PLUGIN_COMMONJS']) {
    config = mergeConfig(config, {
      optimizeDeps: { disabled: false },
      ssr: { optimizeDeps: { disabled: false } },
    })
    config.build ??= {}
    config.build.commonjsOptions = { include: [] }
  }

  // Define logger
  const logger =
    config.logger ??
    createLogger(config.logLevel, {
      allowClearScreen: config.clearScreen,
    })

  // resolve root
  const resolvedRoot = normalizePath(config.root ? path.resolve(config.root) : process.cwd())

  const clientAlias = [
    {
      find: /^\/?@vite\/env/,
      replacement: path.posix.join(FS_PREFIX, normalizePath(ENV_ENTRY)),
    },
    {
      find: /^\/?@vite\/client/,
      replacement: path.posix.join(FS_PREFIX, normalizePath(CLIENT_ENTRY)),
    },
  ]

  // resolve alias with internal client alias
  const resolvedAlias = normalizeAlias(mergeAlias(clientAlias, config.resolve?.alias ?? []))

  const resolveOptions: ResolvedConfig['resolve'] = {
    mainFields: config.resolve?.mainFields ?? DEFAULT_MAIN_FIELDS,
    browserField: config.resolve?.browserField ?? true,
    conditions: config.resolve?.conditions ?? [],
    extensions: config.resolve?.extensions ?? DEFAULT_EXTENSIONS,
    dedupe: config.resolve?.dedupe ?? [],
    preserveSymlinks: config.resolve?.preserveSymlinks ?? false,
    alias: resolvedAlias,
  }

  // load .env files
  const envDir = config.envDirectory
    ? normalizePath(path.resolve(resolvedRoot, config.envDirectory))
    : resolvedRoot

  const userEnv =
    inlineConfig.envFile !== false && loadEnv(mode, envDir, resolveEnvPrefix(config.envPrefix))

  // Note it is possible for user to have a custom mode, e.g. `staging` where
  // development-like behavior is expected. This is indicated by NODE_ENV=development
  // loaded from `.staging.env` and set by us as VITE_USER_NODE_ENV
  const userNodeEnv = process.env['VITE_USER_NODE_ENV']

  if (!isNodeEnvSet && userNodeEnv) {
    if (userNodeEnv === 'development') {
      process.env['NODE_ENV'] = 'development'
    } else {
      // NODE_ENV=production is not supported as it could break HMR in dev for frameworks like Vue
      logger.warn(
        `NODE_ENV=${userNodeEnv} is not supported in the .env file. ` +
          `Only NODE_ENV=development is supported to create a development build of your project. ` +
          `If you need to set process.env.NODE_ENV, you can set it in the Vite config instead.`,
      )
    }
  }

  const isProduction = process.env['NODE_ENV'] === 'production'

  // resolve public base url
  const isBuild = command === 'build'
  const relativeBaseShortcut = config.base === '' || config.base === './'

  // During dev, we ignore relative base and fallback to '/'
  // For the SSR build, relative base isn't possible by means
  // of import.meta.url.
  const resolvedBase = relativeBaseShortcut
    ? !isBuild || config.build?.ssr
      ? '/'
      : './'
    : resolveBaseUrl(config.base, isBuild, logger) ?? '/'

  /**
   * TODO
   */
  const resolvedBuildOptions = resolveBuildOptions(config.build, logger, resolvedRoot)

  // resolve cache directory
  const pkgDir = findNearestPackageData(resolvedRoot, packageCache)?.directory

  const cacheDir = normalizePath(
    config.cacheDirectory
      ? path.resolve(resolvedRoot, config.cacheDirectory)
      : pkgDir
      ? path.join(pkgDir, `node_modules/.vite`)
      : path.join(resolvedRoot, `.vite`),
  )

  const assetsFilter =
    config.assetsInclude && (!Array.isArray(config.assetsInclude) || config.assetsInclude.length)
      ? createFilter(config.assetsInclude)
      : () => false

  // create an internal resolver to be used in special scenarios, e.g.
  // optimizer & handling css @imports
  const createResolver: ResolvedConfig['createResolver'] = (options) => {
    let aliasContainer: PluginContainer | undefined
    let resolverContainer: PluginContainer | undefined

    return async (id, importer, aliasOnly, ssr) => {
      let container: PluginContainer

      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [aliasPlugin({ entries: resolved.resolve.alias })],
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              aliasPlugin({ entries: resolved.resolve.alias }),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                ssrConfig: resolved.ssr,
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options,
                idOnly: true,
              }),
            ],
          }))
      }
      return (await container.resolveId(id, importer, { ssr, scan: options?.scan }))?.id
    }
  }

  const { publicDirectory } = config

  const resolvedPublicDir =
    publicDirectory !== false && publicDirectory !== ''
      ? path.resolve(resolvedRoot, typeof publicDirectory === 'string' ? publicDirectory : 'public')
      : ''

  const server = resolveServerOptions(resolvedRoot, config.server, logger)

  const ssr = resolveSSROptions(
    config.ssr,
    resolveOptions.preserveSymlinks,
    config.legacy?.buildSsrCjsExternalHeuristics,
  )

  const middlewareMode = config?.server?.middlewareMode

  const optimizeDeps = config.optimizeDependencies || {}

  const BASE_URL = resolvedBase

  let workerConfig = mergeConfig({}, config)

  const [workerPrePlugins, workerNormalPlugins, workerPostPlugins] =
    sortUserPlugins(rawWorkerUserPlugins)

  // run config hooks
  const workerUserPlugins = [...workerPrePlugins, ...workerNormalPlugins, ...workerPostPlugins]
  workerConfig = await runConfigHook(workerConfig, workerUserPlugins, configEnv)

  const resolvedWorkerOptions: ResolveWorkerOptions = {
    format: workerConfig.worker?.format || 'iife',
    plugins: [],
    rollupOptions: workerConfig.worker?.rollupOptions || {},
    getSortedPlugins: undefined!,
    getSortedPluginHooks: undefined!,
  }

  const resolvedConfig: ResolvedConfig = {
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies: configFileDependencies.map((name) => normalizePath(path.resolve(name))),
    inlineConfig,
    root: resolvedRoot,
    base: resolvedBase.endsWith('/') ? resolvedBase : resolvedBase + '/',
    rawBase: resolvedBase,
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    ssr,
    isWorker: false,
    mainConfig: null,
    isProduction,
    plugins: userPlugins,
    css: resolveCSSOptions(config.css),
    esbuild:
      config.esbuild === false
        ? false
        : {
            jsxDev: !isProduction,
            ...config.esbuild,
          },
    server,
    build: resolvedBuildOptions,
    preview: resolvePreviewOptions(config.preview, server),
    envDir,
    env: {
      ...userEnv,
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction,
    },
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_REGEX.test(file) || assetsFilter(file)
    },
    logger,
    packageCache,
    createResolver,
    optimizeDeps: {
      disabled: 'build',
      ...optimizeDeps,
      esbuildOptions: {
        preserveSymlinks: resolveOptions.preserveSymlinks,
        ...optimizeDeps.esbuildOptions,
      },
    },
    worker: resolvedWorkerOptions,
    appType: config.appType ?? (middlewareMode === 'ssr' ? 'custom' : 'spa'),
    experimental: {
      importGlobRestoreExtension: false,
      hmrPartialAccept: false,
      ...config.experimental,
    },
    getSortedPlugins: undefined as any,
    getSortedPluginHooks: undefined as any,
  }

  const resolved: ResolvedConfig = {
    ...config,
    ...resolvedConfig,
  }

  return resolved
}

interface ConfigLoadedFromFile {
  path: string
  config: UserConfig
  dependencies: string[]
}

export async function loadConfigFromFile(
  configEnv: ConfigEnv,
  configFile?: string,
  configRoot = process.cwd(),
  logLevel?: LogLevel,
): Promise<ConfigLoadedFromFile | undefined> {
  const start = performance.now()

  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath = configFile ? path.resolve(configFile) : findConfigFile(configRoot)

  if (!resolvedPath) {
    debug?.('no config file found.')
    return
  }

  let isESM = false

  if (/\.m[jt]s$/.test(resolvedPath)) {
    isESM = true
  } else if (/\.c[jt]s$/.test(resolvedPath)) {
    isESM = false
  } else {
    // check package.json for type: "module" and set `isESM` to true
    try {
      const pkg = lookupFile(configRoot, ['package.json'])
      isESM = !!pkg && JSON.parse(fs.readFileSync(pkg, 'utf-8')).type === 'module'
    } catch {}
  }

  try {
    const bundled = await bundleConfigFile(resolvedPath, isESM)

    const userConfig = await loadConfigFromBundledFile(resolvedPath, bundled.code, isESM)

    debug?.(`bundled config file loaded in ${getTime()}`)

    const config = await (typeof userConfig === 'function' ? userConfig(configEnv) : userConfig)

    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }

    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies: bundled.dependencies,
    }
  } catch (e) {
    createLogger(logLevel).error(colors.red(`failed to load config from ${resolvedPath}`), {
      error: e as Error,
    })
    throw e
  }
}

interface BundledConfigFile {
  code: string
  dependencies: string[]
}

async function bundleConfigFile(fileName: string, isESM = false): Promise<BundledConfigFile> {
  // When a file references `__dirname`, redirect it to a custom variable name.
  // Then, using ESBuild's `onLoad` hook, define this custom variable name at the top of the file.

  const dirnameVarName = '__vite_injected_original_dirname'
  const filenameVarName = '__vite_injected_original_filename'
  const importMetaUrlVarName = '__vite_injected_original_import_meta_url'

  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    outfile: 'out.js',
    write: false,
    target: ['node14.18', 'node16'],
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    mainFields: ['main'],
    sourcemap: 'inline',
    metafile: true,
    define: {
      __dirname: dirnameVarName,
      __filename: filenameVarName,
      'import.meta.url': importMetaUrlVarName,
    },
    plugins: [
      {
        name: 'externalize-dependencies',
        setup(build) {
          const packageCache = new Map()

          const resolveByViteResolver = (id: string, importer: string, isRequire: boolean) => {
            return tryNodeResolve(
              id,
              importer,
              {
                root: path.dirname(fileName),
                isBuild: true,
                isProduction: true,
                preferRelative: false,
                tryIndex: true,
                mainFields: [],
                browserField: false,
                conditions: [],
                overrideConditions: ['node'],
                dedupe: [],
                extensions: DEFAULT_EXTENSIONS,
                preserveSymlinks: false,
                packageCache,
                isRequire,
              },
              false,
            )?.id
          }

          const isESMFile = (id: string): boolean => {
            if (id.endsWith('.mjs')) {
              return true
            }

            if (id.endsWith('.cjs')) {
              return false
            }

            const nearestPackageJson = findNearestPackageData(path.dirname(id), packageCache)

            return nearestPackageJson?.packageJson.type === 'module'
          }

          // externalize bare imports
          build.onResolve({ filter: /^[^.].*/ }, async ({ path: id, importer, kind }) => {
            if (kind === 'entry-point' || path.isAbsolute(id) || isBuiltin(id)) {
              return
            }

            // partial deno support as `npm:` does not work with esbuild
            if (id.startsWith('npm:')) {
              return { external: true }
            }

            const isImport = isESM || kind === 'dynamic-import'

            let filePath: string | undefined

            try {
              filePath = resolveByViteResolver(id, importer, !isImport)
            } catch (e) {
              if (!isImport) {
                let canResolveWithImport = false

                try {
                  canResolveWithImport = !!resolveByViteResolver(id, importer, false)
                } catch {}

                if (canResolveWithImport) {
                  throw new Error(
                    `Failed to resolve ${JSON.stringify(id)}.` +
                      `This package is ESM only but it was tried to load by \`require\`. See http://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
                  )
                }
              }

              throw e
            }

            if (filePath && isImport) {
              filePath = pathToFileURL(filePath).href
            }

            if (filePath && !isImport && isESMFile(filePath)) {
              throw new Error(
                `${JSON.stringify(
                  id,
                )} resolved to an ESM file. ESM file cannot be loaded by \`require\`. See http://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
              )
            }

            return {
              path: filePath,
              external: true,
            }
          })
        },
      },
      {
        name: 'inject-file-scope-variables',
        setup(build) {
          build.onLoad({ filter: /\.[cm]?[jt]s$/ }, (args) => {
            const contents = fs.readFileSync(args.path, 'utf8')

            const banner =
              `const ${dirnameVarName} = ${JSON.stringify(path.dirname(args.path))};` +
              `const ${filenameVarName} = ${JSON.stringify(args.path)};` +
              `const ${importMetaUrlVarName} = ${JSON.stringify(pathToFileURL(args.path).href)};`

            return {
              loader: args.path.endsWith('ts') ? 'ts' : 'js',
              contents: banner + contents,
            }
          })
        },
      },
    ],
  })

  return {
    code: result.outputFiles[0]?.text ?? '',
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : [],
  }
}

function findConfigFile(root: string, configFiles = DEFAULT_CONFIG_FILES): string | undefined {
  return configFiles.map((file) => path.resolve(root, file)).find((file) => fs.existsSync(file))
}

interface NodeModuleWithCompile extends NodeModule {
  _compile(code: string, filename: string): any
}

const _require = createRequire(import.meta.url)

async function loadConfigFromBundledFile(
  fileName: string,
  bundledCode: string,
  isESM: boolean,
): Promise<UserConfigExport> {
  // for esm, before we can register loaders without requiring users to run node
  // with --experimental-loader themselves, we have to do a hack here:
  // write it to disk, load it with native Node ESM, then delete the file.
  if (isESM) {
    const fileBase = `${fileName}.timestamp-${Date.now()}-${Math.random().toString(16).slice(2)}`

    const fileNameTmp = `${fileBase}.mjs`

    const fileUrl = `${pathToFileURL(fileBase)}.mjs`

    fs.writeFileSync(fileNameTmp, bundledCode)

    try {
      return (await dynamicImport(fileUrl)).default
    } finally {
      fs.unlink(fileNameTmp, () => {}) // Ignore errors
    }
  }

  // for cjs, we can register a custom loader via `_require.extensions`
  else {
    const extension = path.extname(fileName)
    // We don't use fsp.realpath() here because it has the same behaviour as
    // fs.realpath.native. On some Windows systems, it returns uppercase volume
    // letters (e.g. "C:\") while the Node.js loader uses lowercase volume letters.
    // See https://github.com/vitejs/vite/issues/12923
    const realFileName = await promisifiedRealpath(fileName)
    const loaderExt = extension in _require.extensions ? extension : '.js'
    const defaultLoader = _require.extensions[loaderExt]!

    _require.extensions[loaderExt] = (module: NodeModule, filename: string) => {
      if (filename === realFileName) {
        ;(module as NodeModuleWithCompile)._compile(bundledCode, filename)
      } else {
        defaultLoader(module, filename)
      }
    }

    // clear cache in case of server restart
    delete _require.cache[_require.resolve(fileName)]

    const raw = _require(fileName)

    _require.extensions[loaderExt] = defaultLoader

    return raw.__esModule ? raw.default : raw
  }
}

export function sortUserPlugins(plugins?: (Plugin | Plugin[])[]): [Plugin[], Plugin[], Plugin[]] {
  if (plugins == null) {
    return [[], [], []]
  }

  const prePlugins = plugins.flat().filter((plugin) => plugin.enforce === 'pre')

  const postPlugins = plugins.flat().filter((plugin) => plugin.enforce === 'post')

  const normalPlugins = plugins
    .flat()
    .filter((plugin) => plugin.enforce !== 'pre' && plugin.enforce !== 'post')

  return [prePlugins, normalPlugins, postPlugins]
}

async function runConfigHook(
  config: InlineConfig,
  plugins: Plugin[],
  configEnv: ConfigEnv,
): Promise<InlineConfig> {
  /**
   * This config will be iterated on by the plugin hooks.
   */
  let currentConfig = config

  for (const plugin of getSortedPluginsBy('config', plugins)) {
    const hook = plugin.config
    const handler = hook && 'handler' in hook ? hook.handler : hook

    if (!handler) {
      continue
    }

    const res = await handler(currentConfig, configEnv)

    if (res) {
      currentConfig = mergeConfig(currentConfig, res)
    }
  }

  return currentConfig
}

/**
 * Resolve base url. Note that some users use Vite to build for non-web targets like
 * electron or expects to deploy
 */
export function resolveBaseUrl(
  base: UserConfig['base'] = '/',
  isBuild: boolean,
  logger: Logger,
): string {
  if (base[0] === '.') {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) invalid "base" option: ${base}. The value can only be an absolute ` +
            `URL, ./, or an empty string.`,
        ),
      ),
    )
    return '/'
  }

  // external URL flag
  const isExternal = isExternalUrl(base)

  // no leading slash warn
  if (!isExternal && base[0] !== '/') {
    logger.warn(colors.yellow(colors.bold(`(!) "base" option should start with a slash.`)))
  }

  // parse base when command is serve or base is not External URL
  if (!isBuild || !isExternal) {
    base = new URL(base, 'http://vitejs.dev').pathname

    // ensure leading slash
    if (base[0] !== '/') {
      base = '/' + base
    }
  }

  return base
}

export interface ResolveWorkerOptions extends PluginHookUtils {
  format: 'es' | 'iife'
  plugins: Plugin[]
  rollupOptions: RollupOptions
}
