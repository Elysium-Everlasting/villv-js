import type { BuildOptions } from 'esbuild'

/**
 * TODO
 */
export interface DependencyOptimizer {
  metadata: DependencyOptimizationMetadata

  scanProcessing?: Promise<void>

  registerMissingImport: (id: string, resolved: string) => OptimizedDependencyInfo

  run: () => void

  isOptimizedDepFile: (id: string) => boolean

  isOptimizedDepUrl: (url: string) => boolean

  getOptimizedDepId: (dependencyInfo: OptimizedDependencyInfo) => string

  delayDepsOptimizerUntil: (id: string, done: () => Promise<unknown>) => void

  registerWorkersSource: (id: string) => void

  resetRegisteredIds: () => void

  ensureFirstRun: () => void

  close: () => Promise<void>

  options: DependencyOptimizationOptions
}

/**
 * TODO: move this to src/node/optimizer/index.ts
 */
export interface DependencyOptimizationConfig {
  /**
   * Force optimize listed dependencies (must be resolvable import paths, cannot be globs).
   */
  include?: string[]

  /**
   * Do not optimize these dependencies (must be resolvable import paths, cannot be globs).
   */
  exclude?: string[]

  /**
   * Forces ESM interop when importing these dependencies.
   * Some legacy packages advertise themselves as ESM but use `require` internally
   *
   * @experimental
   */
  needsInterop?: string[]

  /**
   * Options to pass to esbuild during the dep scanning and optimization.
   *
   * Certain options are omitted since changing them would not be compatible with Vite's dep optimization.
   *
   * - `external` is also omitted, use Vite's `optimizeDeps.exclude` option
   * - `plugins` are merged with Vite's dep plugin
   *
   * https://esbuild.github.io/api
   */
  esbuildOptions?: Omit<
    BuildOptions,
    | 'bundle'
    | 'entryPoints'
    | 'external'
    | 'write'
    | 'watch'
    | 'outdir'
    | 'outfile'
    | 'outbase'
    | 'outExtension'
    | 'metafile'
  >

  /**
   * List of file extensions that can be optimized.
   * A corresponding esbuild plugin must exist to handle the specific extension.
   *
   * By default, Vite can optimize `.mjs`, `.js`, `.ts`, and `.mts` files.
   * This option allows specifying additional extensions.
   *
   * @experimental
   */
  extensions?: string[]

  /**
   * Disables dependencies optimizations, true disables the optimizer during build and dev.
   * Pass 'build' or 'dev' to only disable the optimizer in one of the modes.
   * Deps optimization is enabled by default in dev only.
   *
   * @default 'build'
   *
   * @experimental
   */
  disabled?: boolean | 'build' | 'dev'

  /**
   * Automatic dependency discovery.
   *
   * When `noDiscovery` is true, only dependencies listed in `include` will be optimized.
   * The scanner isn't run for cold start in this case.
   * CJS-only dependencies must be present in `include` during dev.
   *
   * @default false
   *
   * @experimental
   */
  noDiscovery?: boolean
}

export type DependencyOptimizationOptions = DependencyOptimizationConfig & {
  /**
   * By default, Vite will crawl your `index.html` to detect dependencies that
   * need to be pre-bundled. If `build.rollupOptions.input` is specified, Vite
   * will crawl those entry points instead.
   *
   * If neither of these fit your needs, you can specify custom entries using
   * this option - the value should be a fast-glob pattern or array of patterns
   * (https://github.com/mrmlnc/fast-glob#basic-syntax) that are relative from
   * vite project root. This will overwrite default entries inference.
   */
  entries?: string | string[]
  /**
   * Force dep pre-optimization regardless of whether deps have changed.
   * @experimental
   */
  force?: boolean
}

/**
 * Info about how a dependency can be optimized?
 */
export interface DependencyOptimizationMetadata {
  /**
   * The main hash is determined by user config and dependency lockfiles.
   * This is checked on file startup to avoid unneccessary re-renders.
   */
  hash: string

  /**
   * The browser hash is determined by {@link hash} and additional dependencies discovered
   * during runtime. This is used to invalidate browser requests for optimized dependencies.
   */
  browserHash: string

  /**
   * Metadata for all already optimized dependencies.
   */
  optimized: Record<string, OptimizedDependencyInfo>

  /**
   * Metadata for non-entry optimized chunks and dynamic imports.
   */
  chunks: Record<string, OptimizedDependencyInfo>

  /**
   * Metadata for newly discovered dependencies after processing.
   */
  discovered: Record<string, OptimizedDependencyInfo>

  /**
   * Metadata for all dependencies?
   */
  dependencyInfoList: OptimizedDependencyInfo[]
}

export interface OptimizedDependencyInfo {
  /**
   * Unique ID, i.e. file path?
   */
  id: string

  /**
   * Another file path?
   */
  file: string

  /**
   * And another file path?
   */
  src?: string

  /**
   * Whether it needs ESM interop?
   */
  needsInterop?: boolean

  /**
   * Browser hash?
   */
  browserHash?: string

  /**
   * Main hash?
   */
  fileHash?: string

  /**
   * Idk.
   */
  processing?: Promise<void>

  /**
   * Idk.
   */
  exportsData?: Promise<ExportsData>
}

export interface ExportsData {
  /**
   * Whether the depedenency has any imports.
   */
  hasImports?: boolean

  /**
   * Named exports.
   *
   * @example
   *
   * ```ts
   * const a = 'I LOVE APONIA'
   *
   * export { a as b }  // b is the named export
   * ```
   */
  exports: readonly string[]

  /**
   * Hint whether the dependency requires loading as JSX.
   */
  jsxLoader?: boolean
}

export function optimizedDependencyInfoFromFile(
  metadta: DependencyOptimizationMetadata,
  file: string,
): OptimizedDependencyInfo | undefined {
  return metadta.dependencyInfoList.find((dependencyInfo) => dependencyInfo.file === file)
}
