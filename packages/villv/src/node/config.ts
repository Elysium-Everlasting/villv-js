import fs from 'node:fs'
import path from 'node:path'
import colors from 'picocolors'
import { build, type BuildOptions as ESBuildOptions } from 'esbuild'
import type { RollupOptions } from 'rollup'
import type { RollupAliasOptions } from '@rollup/plugin-alias'
import type { Plugin } from './plugin.js'
import { createLogger, type LogLevel, type Logger } from './logger.js'
import { tryNodeResolve, type ResolveOptions } from './plugins/resolve.js'
import type { CssOptions } from './plugins/css.js'
import type { JsonOptions } from './plugins/json.js'
import type { ServerOptions } from './server/index.js'
import type { BuildOptions } from './server/build.js'
import { findNearestPackageData, type PackageCache } from './packages.js'
import { DEFAULT_CONFIG_FILES, DEFAULT_EXTENSIONS } from './constants.js'
import { createDebugger, isBuiltin, lookupFile } from './utils.js'
import { promisify } from 'util'
import { pathToFileURL } from 'node:url'

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

/**
 * TODO
 */
export interface ResolvedConfig extends UserConfig {}

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

const debug = createDebugger('vite:config')

// const promisifiedRealpath = promisify(fs.realpath)

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

  if (config !== false) {
  }

  return config
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
): Promise<ConfigLoadedFromFile | null> {
  const start = performance.now()

  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath = configFile ? path.resolve(configFile) : findConfigFile(configRoot)

  if (!resolvedPath) {
    debug?.('no config file found.')
    return null
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
