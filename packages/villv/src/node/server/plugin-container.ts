import fs from 'node:fs'
import path from 'node:path'
import acorn from 'acorn'
import postcss from 'postcss'
import colors from 'picocolors'
import MagicString from 'magic-string'
import { VERSION as rollupVersion } from 'rollup'
import type {
  AsyncPluginHooks,
  CustomPluginOptions,
  FunctionPluginHooks,
  InputOptions,
  LoadResult,
  MinimalPluginContext,
  ModuleInfo,
  NormalizedInputOptions,
  ParallelPluginHooks,
  PartialResolvedId,
  SourceDescription,
  SourceMap,
  TransformResult,
  PluginContext as RollupPluginContext,
  ResolvedId,
  PartialNull,
  ModuleOptions,
  RollupLog,
  RollupError,
  EmittedFile,
} from 'rollup'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import type { Plugin } from '../plugin.js'
import type { FSWatcher } from 'chokidar'
import type { ResolvedConfig } from '../config.js'
import {
  cleanUrl,
  combineSourceMaps,
  createDebugger,
  ensureWatchedFile,
  formatUrl,
  generateCodeFrame,
  isExternalUrl,
  isObject,
  normalizePath,
  numberToPosition,
  pad,
  timeFrom,
  toArray,
  unwrapId,
} from '../utils.js'
import { createPluginHookUtils } from '../plugins/index.js'
import { FS_PREFIX } from '../constants.js'
import type { RawSourceMap } from '@ampproject/remapping'

function cleanStack(stack: string) {
  return stack
    .split(/\n/g)
    .filter((l) => /^\s*at/.test(l))
    .join('\n')
}

/**
 * TODO: this was in src/node/middlewares/error.ts
 */
export function buildErrorMessage(
  err: RollupError,
  args: string[] = [],
  includeStack = true,
): string {
  const errorMessageLines = [...args]

  if (err.plugin) {
    errorMessageLines.push(`  Plugin: ${colors.magenta(err.plugin)}`)
  }

  const loc = err.loc ? `:${err.loc.line}:${err.loc.column}` : ''

  if (err.id) {
    errorMessageLines.push(`  File: ${colors.cyan(err.id)}${loc}`)
  }

  if (err.frame) {
    errorMessageLines.push(colors.yellow(pad(err.frame)))
  }

  if (includeStack && err.stack) {
    errorMessageLines.push(pad(cleanStack(err.stack)))
  }

  return errorMessageLines.join('\n')
}

type PluginContext = Omit<
  RollupPluginContext,
  // not documented
  | 'cache'
  // deprecated
  | 'moduleIds'
>

/**
 * Idk what a plugin container is.
 */
export interface PluginContainer {
  /**
   * Rollup input.
   */
  options: InputOptions

  /**
   */
  getModuleInfo: (id: string) => ModuleInfo | null

  /**
   * Hook to run before the build starts.
   */
  buildStart: (options: InputOptions) => Promise<unknown>

  /**
   */
  resolveId: (
    id: string,
    importer?: string,
    options?: ResolveIdOptions,
  ) => Promise<PartialResolvedId | null>

  /**
   */
  transform: (code: string, id: string, options?: TransformOptions) => Promise<unknown>

  /**
   */
  load: (id: string, options?: LoadOptions) => Promise<LoadResult | null>

  close: () => Promise<void>
}

/**
 * Options for {@link PluginContainer.resolveId}.
 */
export interface ResolveIdOptions {
  /**
   * Idk.
   */
  assertions?: Record<string, string>

  /**
   * Custom plugin thing?
   */
  custom?: CustomPluginOptions

  /**
   * Idk.
   */
  skip?: Set<Plugin>

  /**
   * Idk.
   */
  ssr?: boolean

  /**
   * Idk.
   */
  scan?: boolean

  /**
   * Idk.
   */
  isEntry?: boolean
}

/**
 * Options for {@link PluginContainer.transform}.
 */
export interface TransformOptions {
  /**
   * Idk.
   */
  inMap?: SourceDescription['map']

  /**
   * Idk.
   */
  ssr?: boolean
}

/**
 * Options for {@link PluginContainer.load}.
 */
export interface LoadOptions {
  /**
   * Idk.
   */
  ssr?: boolean
}

export let parser = acorn.Parser

export async function createPluginContainer(
  config: ResolvedConfig,
  moduleGraph?: any, // ModuleGraph,
  watcher?: FSWatcher,
): Promise<PluginContainer> {
  const {
    plugins,
    logger,
    root,
    build: { rollupOptions },
  } = config

  const { getSortedPluginHooks, getSortedPlugins } = createPluginHookUtils(plugins)

  const processesing = new Set<Promise<any>>()

  const seenResolves: Record<string, true | undefined> = {}

  const debugResolve = createDebugger('vite:resolve')

  const debugPluginResolve = createDebugger('vite:plugin-resolve', {
    onlyWhenFocused: 'vite:plugin',
  })

  const debugPluginTransform = createDebugger('vite:plugin-transform', {
    onlyWhenFocused: 'vite:plugin',
  })

  const debugSourcemapCombineFilter = process.env['DEBUG_VITE_SOURCEMAP_COMBINE_FILTER']

  const debugSourcemapCombine = createDebugger('vite:sourcemap-combine', {
    onlyWhenFocused: true,
  })

  function warnIncompatibleMethod(method: string, plugin: string) {
    logger.warn(
      colors.cyan(`[plugin:${plugin}] `) +
        colors.yellow(
          `context method ${colors.bold(
            `${method}()`,
          )} is not supported in serve mode. This plugin is likely not vite-compatible.`,
        ),
    )
  }

  function handleHookPromise<T>(maybePromise: undefined | T | Promise<T>) {
    if (!(maybePromise as any)?.then) {
      return maybePromise
    }

    const promise = maybePromise as Promise<T>

    processesing.add(promise)

    return promise.finally(() => processesing.delete(promise))
  }

  const watchFiles = new Set<string>()

  const minimalContext: MinimalPluginContext = {
    meta: {
      rollupVersion,
      watchMode: true,
    },
    debug: noop,
    info: noop,
    warn: noop,
    error: noop as any,
  }

  async function getOptions() {
    let options = rollupOptions

    for (const optionsHook of getSortedPluginHooks('options')) {
      if (closed) {
        throwClosedServerError()
      }

      options = (await handleHookPromise(optionsHook.call(minimalContext, options))) || options
    }

    if (options.acornInjectPlugins) {
      parser = acorn.Parser.extend(...(toArray(options.acornInjectPlugins) as any))
    }

    return {
      acorn,
      acornInjectPlugins: [],
      ...options,
    }
  }

  // parallel, ignores returns
  async function hookParallel<H extends AsyncPluginHooks & ParallelPluginHooks>(
    hookName: H,
    context: (plugin: Plugin) => ThisType<FunctionPluginHooks[H]>,
    args: (plugin: Plugin) => Parameters<FunctionPluginHooks[H]>,
  ): Promise<void> {
    const parallelPromises: Promise<unknown>[] = []

    for (const plugin of getSortedPlugins(hookName)) {
      // Don't throw here if closed, so buildEnd and closeBundle hooks can finish running
      const hook = plugin[hookName]

      if (!hook) {
        continue
      }

      const handler: Function = 'handler' in hook ? hook.handler : hook

      if ((hook as { sequential?: boolean }).sequential) {
        await Promise.all(parallelPromises)
        parallelPromises.length = 0
        await handler.apply(context(plugin), args(plugin))
      } else {
        parallelPromises.push(handler.apply(context(plugin), args(plugin)))
      }
    }
    await Promise.all(parallelPromises)
  }

  // throw when an unsupported ModuleInfo property is accessed,
  // so that incompatible plugins fail in a non-cryptic way.
  const ModuleInfoProxy: ProxyHandler<ModuleInfo> = {
    get(info: any, key: string) {
      if (key in info) {
        return info[key]
      }

      // Don't throw an error when returning from an async function
      if (key === 'then') {
        return undefined
      }

      throw Error(`[vite] The "${key}" property of ModuleInfo is not supported.`)
    },
  }

  // same default value of "moduleInfo.meta" as in Rollup
  const EMPTY_OBJECT = Object.freeze({})

  function getModuleInfo(id: string) {
    const module = moduleGraph?.getModuleById(id)
    if (!module) {
      return null
    }
    if (!module.info) {
      module.info = new Proxy(
        { id, meta: module.meta ?? EMPTY_OBJECT } as ModuleInfo,
        ModuleInfoProxy,
      )
    }
    return module.info
  }

  function updateModuleInfo(id: string, { meta }: { meta?: object | null }) {
    if (meta) {
      const moduleInfo = getModuleInfo(id)
      if (moduleInfo) {
        moduleInfo.meta = { ...moduleInfo.meta, ...meta }
      }
    }
  }

  // we should create a new context for each async hook pipeline so that the
  // active plugin in that pipeline can be tracked in a concurrency-safe manner.
  // using a class to make creating new contexts more efficient
  class Context implements PluginContext {
    meta = minimalContext.meta
    ssr = false
    _scan = false
    _activePlugin: Plugin | null
    _activeId: string | null = null
    _activeCode: string | null = null
    _resolveSkips?: Set<Plugin>
    _addedImports: Set<string> | null = null

    constructor(initialPlugin?: Plugin) {
      this._activePlugin = initialPlugin || null
    }

    parse(code: string, opts: any = {}) {
      return parser.parse(code, {
        sourceType: 'module',
        ecmaVersion: 'latest',
        locations: true,
        ...opts,
      })
    }

    async resolve(
      id: string,
      importer?: string,
      options?: {
        assertions?: Record<string, string>
        custom?: CustomPluginOptions
        isEntry?: boolean
        skipSelf?: boolean
      },
    ) {
      let skip: Set<Plugin> | undefined

      if (options?.skipSelf && this._activePlugin) {
        skip = new Set(this._resolveSkips)
        skip.add(this._activePlugin)
      }

      let out = await container.resolveId(id, importer, {
        assertions: options?.assertions,
        custom: options?.custom,
        isEntry: !!options?.isEntry,
        skip,
        ssr: this.ssr,
        scan: this._scan,
      })

      if (typeof out === 'string') {
        out = { id: out }
      }

      return out as ResolvedId | null
    }

    async load(
      options: {
        id: string
        resolveDependencies?: boolean
      } & Partial<PartialNull<ModuleOptions>>,
    ): Promise<ModuleInfo> {
      // We may not have added this to our module graph yet, so ensure it exists
      await moduleGraph?.ensureEntryFromUrl(unwrapId(options.id), this.ssr)
      // Not all options passed to this function make sense in the context of loading individual files,
      // but we can at least update the module info properties we support
      updateModuleInfo(options.id, options)

      await container.load(options.id, { ssr: this.ssr })
      const moduleInfo = this.getModuleInfo(options.id)
      // This shouldn't happen due to calling ensureEntryFromUrl, but 1) our types can't ensure that
      // and 2) moduleGraph may not have been provided (though in the situations where that happens,
      // we should never have plugins calling this.load)
      if (!moduleInfo) throw Error(`Failed to load module with id ${options.id}`)
      return moduleInfo
    }

    getModuleInfo(id: string) {
      return getModuleInfo(id)
    }

    getModuleIds() {
      return moduleGraph ? moduleGraph.idToModuleMap.keys() : Array.prototype[Symbol.iterator]()
    }

    addWatchFile(id: string) {
      watchFiles.add(id)
      ;(this._addedImports || (this._addedImports = new Set())).add(id)
      if (watcher) ensureWatchedFile(watcher, id, root)
    }

    getWatchFiles() {
      return [...watchFiles]
    }

    emitFile(_assetOrFile: EmittedFile) {
      warnIncompatibleMethod(`emitFile`, this._activePlugin!.name)
      return ''
    }

    setAssetSource() {
      warnIncompatibleMethod(`setAssetSource`, this._activePlugin!.name)
    }

    getFileName() {
      warnIncompatibleMethod(`getFileName`, this._activePlugin!.name)
      return ''
    }

    warn(
      e: string | RollupLog | (() => string | RollupLog),
      position?: number | { column: number; line: number },
    ) {
      const err = formatError(typeof e === 'function' ? e() : e, position, this)
      const msg = buildErrorMessage(err, [colors.yellow(`warning: ${err.message}`)], false)
      logger.warn(msg, {
        clear: true,
        timestamp: true,
      })
    }

    error(e: string | RollupError, position?: number | { column: number; line: number }): never {
      // error thrown here is caught by the transform middleware and passed on
      // the the error middleware.
      throw formatError(e, position, this)
    }

    debug = noop
    info = noop
  }

  function formatError(
    e: string | RollupError,
    position: number | { column: number; line: number } | undefined,
    ctx: Context,
  ) {
    const err = (typeof e === 'string' ? new Error(e) : e) as postcss.CssSyntaxError & RollupError

    if (err.pluginCode) {
      return err // The plugin likely called `this.error`
    }

    if (err.file && err.name === 'CssSyntaxError') {
      err.id = normalizePath(err.file)
    }

    if (ctx._activePlugin) {
      err.plugin = ctx._activePlugin.name
    }

    if (ctx._activeId && !err.id) {
      err.id = ctx._activeId
    }

    if (ctx._activeCode) {
      err.pluginCode = ctx._activeCode

      // some rollup plugins, e.g. json, sets err.position instead of err.pos
      const pos = position ?? err.pos ?? (err as any).position

      if (pos != null) {
        let errLocation

        try {
          errLocation = numberToPosition(ctx._activeCode, pos)
        } catch (err2) {
          logger.error(
            colors.red(
              `Error in error handler:\n${(err2 as Error).stack || (err2 as Error).message}\n`,
            ),
            // print extra newline to separate the two errors
            { error: err2 as Error },
          )
          throw err
        }

        err.loc ||= { file: err.id, ...errLocation }
        err.frame ||= generateCodeFrame(ctx._activeCode, pos)
      } else if (err.loc) {
        // css preprocessors may report errors in an included file
        if (!err.frame) {
          let code = ctx._activeCode

          if (err.loc.file) {
            err.id = normalizePath(err.loc.file)

            try {
              code = fs.readFileSync(err.loc.file, 'utf-8')
            } catch {}
          }

          err.frame = generateCodeFrame(code, err.loc)
        }
      } else if ((err as any).line && (err as any).column) {
        err.loc = {
          file: err.id,
          line: (err as any).line,
          column: (err as any).column,
        }

        err.frame ||= generateCodeFrame(err.id!, err.loc)
      }

      if (
        ctx instanceof TransformContext &&
        typeof err.loc?.line === 'number' &&
        typeof err.loc?.column === 'number'
      ) {
        const rawSourceMap = ctx._getCombinedSourcemap()

        if (rawSourceMap) {
          const traced = new TraceMap(rawSourceMap as any)

          const { source, line, column } = originalPositionFor(traced, {
            line: Number(err.loc.line),
            column: Number(err.loc.column),
          })

          if (source && line != null && column != null) {
            err.loc = { file: source, line, column }
          }
        }
      }
    } else if (err.loc) {
      if (!err.frame) {
        let code = err.pluginCode

        if (err.loc.file) {
          err.id = normalizePath(err.loc.file)

          if (!code) {
            try {
              code = fs.readFileSync(err.loc.file, 'utf-8')
            } catch {}
          }
        }
        if (code) {
          err.frame = generateCodeFrame(`${code}`, err.loc)
        }
      }
    }

    if (
      typeof err.loc?.column !== 'number' &&
      typeof err.loc?.line !== 'number' &&
      !err.loc?.file
    ) {
      delete err.loc
    }

    return err
  }

  const container: PluginContainer = {
    options: await getOptions(),

    getModuleInfo,

    async buildStart() {
      await handleHookPromise(
        hookParallel(
          'buildStart',
          (plugin) => new Context(plugin),
          () => [container.options as NormalizedInputOptions],
        ),
      )
    },

    async resolveId(rawId, importer = path.join(root, 'index.html'), options) {
      const skip = options?.skip
      const ssr = options?.ssr
      const scan = !!options?.scan
      const ctx = new Context()

      ctx.ssr = !!ssr
      ctx._scan = scan
      ctx._resolveSkips = skip

      const resolveStart = debugResolve ? performance.now() : 0

      let id: string | null = null

      const partial: Partial<PartialResolvedId> = {}

      for (const plugin of getSortedPlugins('resolveId')) {
        if (closed && !ssr) throwClosedServerError()
        if (!plugin.resolveId) continue
        if (skip?.has(plugin)) continue

        ctx._activePlugin = plugin

        const pluginResolveStart = debugPluginResolve ? performance.now() : 0

        const handler = 'handler' in plugin.resolveId ? plugin.resolveId.handler : plugin.resolveId

        const result = await handleHookPromise(
          handler.call(ctx as any, rawId, importer, {
            assertions: options?.assertions ?? {},
            custom: options?.custom,
            isEntry: !!options?.isEntry,
            ssr,
            scan,
          }),
        )

        if (!result) {
          continue
        }

        if (typeof result === 'string') {
          id = result
        } else {
          id = result.id
          Object.assign(partial, result)
        }

        debugPluginResolve?.(timeFrom(pluginResolveStart), plugin.name, formatUrl(id ?? '', root))

        // resolveId() is hookFirst - first non-null result is returned.
        break
      }

      if (debugResolve && rawId !== id && !rawId.startsWith(FS_PREFIX)) {
        const key = rawId + id

        // avoid spamming
        if (!seenResolves[key]) {
          seenResolves[key] = true
          debugResolve(`${timeFrom(resolveStart)} ${colors.cyan(rawId)} -> ${colors.dim(id)}`)
        }
      }

      if (id) {
        partial.id = isExternalUrl(id) ? id : normalizePath(id)
        return partial as PartialResolvedId
      } else {
        return null
      }
    },

    async load(id, options) {
      const ssr = options?.ssr

      const ctx = new Context()

      ctx.ssr = !!ssr

      for (const plugin of getSortedPlugins('load')) {
        if (closed && !ssr) {
          throwClosedServerError()
        }

        if (!plugin.load) {
          continue
        }

        ctx._activePlugin = plugin

        const handler = 'handler' in plugin.load ? plugin.load.handler : plugin.load
        const result = await handleHookPromise(handler.call(ctx as any, id, { ssr }))

        if (result != null) {
          if (isObject(result)) {
            updateModuleInfo(id, result)
          }
          return result
        }
      }
      return null
    },

    async transform(code, id, options) {
      const inMap = options?.inMap
      const ssr = options?.ssr
      const ctx = new TransformContext(id, code, inMap as SourceMap)

      ctx.ssr = !!ssr

      for (const plugin of getSortedPlugins('transform')) {
        if (closed && !ssr) {
          throwClosedServerError()
        }

        if (!plugin.transform) {
          continue
        }

        ctx._activePlugin = plugin
        ctx._activeId = id
        ctx._activeCode = code

        const start = debugPluginTransform ? performance.now() : 0

        let result: TransformResult | string | undefined

        const handler = 'handler' in plugin.transform ? plugin.transform.handler : plugin.transform

        try {
          result = await handleHookPromise(handler.call(ctx as any, code, id, { ssr }))
        } catch (e) {
          ctx.error(e as RollupError)
        }

        if (!result) {
          continue
        }

        debugPluginTransform?.(timeFrom(start), plugin.name, formatUrl(id, root))

        if (isObject(result)) {
          if (result.code !== undefined) {
            code = result.code

            if (result.map) {
              if (debugSourcemapCombine) {
                // @ts-expect-error inject plugin name for debug purpose
                result.map.name = plugin.name
              }
              ctx.sourcemapChain.push(result.map)
            }
          }

          updateModuleInfo(id, result)
        } else {
          code = result
        }
      }

      return {
        code,
        map: ctx._getCombinedSourcemap(),
      }
    },

    async close() {
      if (closed) {
        return
      }

      closed = true

      await Promise.allSettled(Array.from(processesing))

      const ctx = new Context()

      await hookParallel(
        'buildEnd',
        () => ctx,
        () => [],
      )

      await hookParallel(
        'closeBundle',
        () => ctx,
        () => [],
      )
    },
  }

  class TransformContext extends Context {
    filename: string
    originalCode: string
    originalSourcemap: SourceMap | null = null
    sourcemapChain: NonNullable<SourceDescription['map']>[] = []
    combinedMap: SourceMap | null = null

    constructor(filename: string, code: string, inMap?: SourceMap | string) {
      super()
      this.filename = filename
      this.originalCode = code
      if (inMap) {
        if (debugSourcemapCombine) {
          // @ts-expect-error inject name for debug purpose
          inMap.name = '$inMap'
        }
        this.sourcemapChain.push(inMap)
      }
    }

    _getCombinedSourcemap(createIfNull = false) {
      if (
        debugSourcemapCombine &&
        debugSourcemapCombineFilter &&
        this.filename.includes(debugSourcemapCombineFilter)
      ) {
        debugSourcemapCombine('----------', this.filename)
        debugSourcemapCombine(this.combinedMap)
        debugSourcemapCombine(this.sourcemapChain)
        debugSourcemapCombine('----------')
      }

      let combinedMap = this.combinedMap
      for (let m of this.sourcemapChain) {
        if (typeof m === 'string') {
          m = JSON.parse(m)
        }

        if (!('version' in (m as SourceMap))) {
          // empty, nullified source map
          combinedMap = this.combinedMap = null
          this.sourcemapChain.length = 0
          break
        }

        if (!combinedMap) {
          combinedMap = m as SourceMap
        } else {
          combinedMap = combineSourceMaps(cleanUrl(this.filename), [
            m,
            combinedMap,
          ] as RawSourceMap[]) as SourceMap
        }
      }

      if (!combinedMap) {
        return createIfNull
          ? new MagicString(this.originalCode).generateMap({
              includeContent: true,
              hires: 'boundary',
              source: cleanUrl(this.filename),
            })
          : null
      }

      if (combinedMap !== this.combinedMap) {
        this.combinedMap = combinedMap
        this.sourcemapChain.length = 0
      }
      return this.combinedMap
    }

    getCombinedSourcemap() {
      return this._getCombinedSourcemap(true) as SourceMap
    }
  }

  return container
}

const noop = () => {}

export const ERR_CLOSED_SERVER = 'ERR_CLOSED_SERVER'

export function throwClosedServerError(): never {
  const err: any = new Error('The server is being restarted or closed. Request is outdated')
  err.code = ERR_CLOSED_SERVER

  // This error will be caught by the transform middleware that will
  // send a 504 status code request timeout
  throw err
}
