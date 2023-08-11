import type Terser from 'terser'
import type { InputOption, ModuleFormat, RollupOptions, WatcherOptions } from 'rollup'
import type { TransformOptions } from 'esbuild'
import type { RollupCommonJSOptions } from '@rollup/plugin-commonjs'
import type { RollupDynamicImportVariablesOptions } from '@rollup/plugin-dynamic-import-vars'
import type { CssTransformer } from '../plugins/css'

export interface BuildOptions {
  /**
   * Compatibility transform target. The transform is performed with esbuild and
   * the lowest supported target is es2015/es6.
   *
   * Note this only handles __syntax__ transformation and __not polyfills__ (except for dynamic imports).
   *
   * Default: 'modules' - Similar to '@babel/preset-env' targets.esmodules,
   * transpile for browsers that natively support dynamic ES module imports.
   * @see https://caniuse.com/es6-module-dynamic-import
   *
   * Another speciial value is 'esnext', which only performs minimal transpiling
   * (for minification compat) and assumes native dynamic imports support.
   *
   * For custom targets, {@see https://esbuild.github.io/api/#target} and
   * {@see https://esbuild.github.io/content-types/#javascript} for more details.
   *
   * @default 'modules'
   */
  target?: 'modules' | false | TransformOptions['target']

  /**
   * Whether to inject module preload polyfill.
   * @remarks Does __not__ apply to library mode.
   *
   * @default true
   *
   * @deprecated Use {@link modulePreload.polyFill} instead.
   */
  polyfillModulePreload?: boolean

  /**
   * Configure module preload.
   *
   * @remarks Does __not__ apply to library mode.
   *
   * @default true.
   */
  modulePreload?: boolean | ModulePreloadOptions

  /**
   * Output directory, relative from root, for generated build output.
   *
   * If the directory exists prior to build, it will be removed.
   */
  outDirectory?: string

  /**
   * Directory relative from {@link outdirectory} where the static assets will be placed
   *
   * e.g. js, css, image assets.
   *
   * @default 'assets'
   */
  assetsDirectory?: string

  /**
   * Static asset files smaller than this size (in bytes) will be inlined as base64 strings.
   *
   * Set to 0 to disable (i.e. always emit separate files).
   *
   * @default 4096
   */
  assetsInlineLimit?: number

  /**
   * Whether to code-split CSS. When enabled, CSS in async chunks will be inlined as strings
   * in the chunk and inserted via dynamically created style tags after the chunk is loaded.
   *
   * @default true
   */
  cssCodeSplit?: boolean

  /**
   * Optional separate target for CSS minification.
   *
   * As ESBuild only supports configuring targets to mainstram browsers,
   * users may need this option when they are targeting a nich browser that comes
   * with most modern JavaScript features, but poor CSS support.
   *
   * e.g. Android WeChat WebView, which doesn't support the #RGBA syntax.
   *
   * @default {@link target}
   */
  cssTarget?: TransformOptions['target'] | false

  /**
   * Override CSS minification specifically instead of defaulting to {@link minify},
   * so you can configure minification for JS and CSS separately.
   *
   * @default 'esbuild'
   */
  cssMinify?: boolean | CssTransformer

  /**
   * If:
   *
   * - true, a separate source map file will be created.
   * - inline, the sourcemap will be appended to the resulting output file as a data URI.
   * - hidden, similar to true, except the corresponding sourcemap comments in the bundled
   *   files are suppressed.
   *
   * @default false
   */
  sourcemap?: boolean | SourcemapType

  /**
   * Set to false to disable minification, or specify the minifier to use.
   *
   * @default 'esbuild'
   */
  minify?: boolean | Minifier

  /**
   * Options for terser's minifier.
   *
   * @see https://terser.org/docs/api-reference#minify-options
   */
  terserOptions?: Terser.MinifyOptions

  /**
   * Will be merged with internal Rollup options.
   *
   * @see https://rollupjs.org/configuration-options/
   */
  rollupOptions?: RollupOptions

  /**
   * Options to pass to @rollup/plugin-commonjs.
   */
  commonjsOptions?: RollupCommonJSOptions

  /**
   * Options to pass to @rollup/plugin-dynamic-import-vars.
   */
  dynamicImportVariablesOptions?: RollupDynamicImportVariablesOptions

  /**
   * Whether to write the bundle to disk, e.g. the {@link outDirectory}.
   *
   * @default true
   */
  write?: boolean

  /**
   * Whether to empty the {@link outDirectory} before writing.
   *
   * @default true - when {@link outDirectory} is a sub-directory of the project root.
   */
  emptyOutDirectory?: boolean | null

  /**
   * Whether to copy the public directory (i.e. static assets) to the {@link outDirectory} on write.
   *
   * @default true
   *
   * @experimental
   */
  copyPublicDirectory?: boolean

  /**
   */
  manifest?: boolean

  /**
   */
  library?: LibraryOptions | false

  /**
   * Whether to produce an SSR oriented build.
   *
   * This requires specifying an SSR entry via {@link rollupOptions['input']}
   *
   * @default false
   */
  ssr?: boolean | string

  /**
   * Generate an SSR manifest for determining style links and asset preload directives in production.
   *
   * @default false
   */
  ssrManifiest?: boolean | string

  /**
   * Whether to emit assets during SSR.
   *
   * What does it mean to emit assets?
   *
   * @experimental
   *
   * @default false
   */
  ssrEmitAssets?: boolean

  /**
   * Whether to report compressed chunk sizes.
   *
   * Can slightly improve build speed when set to false (i.e. disabled).
   *
   * @default true
   */
  reportCompressedSize?: boolean

  /**
   * Adjust chunk size warning limit (in kilobytes).
   *
   * @default 500
   */
  chunksSizeWarningLimit?: number

  /**
   * Rollup watcher options.
   *
   * @see https://rollupjs.org/configuration-options/#watch
   *
   * @default null
   */
  watch?: WatcherOptions | null
}

/**
 * A minifier takes in JS/CSS source code and produces minified code.
 * The code can then be deployed by a production server.
 */
export type Minifier = 'terser' | 'esbuild'

/**
 * How to create sourcemaps.
 */
export type SourcemapType = 'inline' | 'hidden'

/**
 * Control how a module is preloaded on the HTML page?
 */
export interface ModulePreloadOptions {
  /**
   * Whether to inject a module preload polyfill.
   *
   * @remarks Does __not__ apply to library mode.
   *
   * @default true
   */
  polyfill?: boolean

  /**
   * Resolve the list of dependencies to preload for a given dynamic import.
   *
   * @experimental
   */
  resolveDependencies?: ResolveModulePreloadDependenciesFn
}

export interface LibraryOptions {
  /**
   * Path of library entry.
   */
  entry: InputOption

  /**
   * The name of the exposed global variable.
   *
   * Required when the {@link formats} option includes 'umd' or 'iife'
   */
  name?: string

  /**
   * Output bundle formats.
   *
   * @default ['es', 'umd']
   */
  formats?: LibraryFormat[]

  /**
   * The name of the package file output.
   *
   * The default filename is the `name` option of the project's package.json .
   *
   * It can also be defined as a function taking the format and entry name as arguments.
   */
  fileName?: string | ((format: ModuleFormat, entryName: string) => string)
}

export type LibraryFormat = 'es' | 'cjs' | 'umd' | 'iife'

/**
 * Determines the list of dependencies to preload for a given dynamic import.
 */
export type ResolveModulePreloadDependenciesFn = (
  filename: string,
  deps: string[],
  context: {
    hostId: string
    hostType: 'html' | 'js'
  },
) => string[]
