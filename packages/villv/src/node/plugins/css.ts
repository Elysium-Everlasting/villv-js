import type { ProcessOptions, AcceptedPlugin } from 'postcss'
import type PostcssModulesPlugin from 'postcss-modules'

export interface CssOptions {
  transformer: CssTransformer

  /**
   * Options passed to the postcss-modules plugin.
   *
   * @see https://github.com/css-modules/postcss-modules
   */
  modules: CssModulesOptions

  /**
   * Idk.
   */
  preprocessorOptions?: Record<string, any>

  /**
   * Options passed to postcss.
   */
  postcss?: string | (ProcessOptions & { plugins?: AcceptedPlugin[] })

  /**
   * Enable CSS source maps during development.
   *
   * @default false
   *
   * @experimental
   */
  devSourceMap?: boolean

  /**
   * Whether to enable using Lightning CSS to resolve CSS imports.
   *
   * @experimental
   */
  lightningcss?: boolean
}

/**
 * Lightning CSS is an experimental option for resolving CSS imports.
 *
 * @see https://github.com/parcel-bundler/lightningcss
 *
 * This requires the package to be installed as a peer dependency,
 * and it is not compatible with pre-processors.
 */
export type CssTransformer = 'postcss' | 'lightningcss'

export type CssModulesOptions = Parameters<PostcssModulesPlugin>[0]
