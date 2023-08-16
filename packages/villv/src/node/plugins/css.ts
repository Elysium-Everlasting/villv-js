import type { BundleAsyncOptions, CustomAtRules } from 'lightningcss'
import type { ProcessOptions, AcceptedPlugin } from 'postcss'
import type PostcssModulesPlugin from 'postcss-modules'

import { ESBUILD_MODULES_TARGET } from '../constants'
import { toArray } from '../utils'

export interface CSSOptions {
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
  preprocessorOptions?: Record<string, unknown>

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
  lightningcss?: LightningCSSOptions
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

export type ResolvedCSSOptions = Omit<CSSOptions, 'lightningcss'> & {
  lightningcss?: LightningCSSOptions & {
    targets: LightningCSSOptions['targets']
  }
}

// remove options set by Vite
export type LightningCSSOptions = Omit<
  BundleAsyncOptions<CustomAtRules>,
  'filename' | 'resolver' | 'minify' | 'sourceMap' | 'analyzeDependencies'
>

export function resolveCSSOptions(options?: CSSOptions): ResolvedCSSOptions | undefined {
  if (options?.lightningcss) {
    return {
      ...options,
      lightningcss: {
        ...options.lightningcss,
        targets: options.lightningcss.targets ?? convertTargets(ESBUILD_MODULES_TARGET),
      },
    }
  }

  /**
   * Inverse 'in' guard doesn't work ??
   *
   * ```ts
   * if (!('lightningcss' in options)) {
   *   // doesn't remove 'lightningcss' from options
   * }
   * ```
   */
  return options as Omit<CSSOptions, 'lightningcss'>
}

const convertTargetsCache = new Map<string | string[], LightningCSSOptions['targets']>()

const esREGEX = /es(\d{4})/

// Convert https://esbuild.github.io/api/#target
// To https://github.com/parcel-bundler/lightningcss/blob/master/node/targets.d.ts
const map: Record<string, keyof NonNullable<LightningCSSOptions['targets']> | false | undefined> = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  hermes: false,
  ie: 'ie',
  ios: 'ios_saf',
  node: false,
  opera: 'opera',
  rhino: false,
  safari: 'safari',
}

const esMap: Record<number, string[]> = {
  // https://caniuse.com/?search=es2015
  2015: ['chrome49', 'edge13', 'safari10', 'firefox44', 'opera36'],

  // https://caniuse.com/?search=es2016
  2016: ['chrome50', 'edge13', 'safari10', 'firefox43', 'opera37'],

  // https://caniuse.com/?search=es2017
  2017: ['chrome58', 'edge15', 'safari11', 'firefox52', 'opera45'],

  // https://caniuse.com/?search=es2018
  2018: ['chrome63', 'edge79', 'safari12', 'firefox58', 'opera50'],

  // https://caniuse.com/?search=es2019
  2019: ['chrome73', 'edge79', 'safari12.1', 'firefox64', 'opera60'],

  // https://caniuse.com/?search=es2020
  2020: ['chrome80', 'edge80', 'safari14.1', 'firefox80', 'opera67'],

  // https://caniuse.com/?search=es2021
  2021: ['chrome85', 'edge85', 'safari14.1', 'firefox80', 'opera71'],

  // https://caniuse.com/?search=es2022
  2022: ['chrome94', 'edge94', 'safari16.4', 'firefox93', 'opera80'],
}

const versionREGEX = /\d/

export function convertTargets(
  esbuildTarget: string | string[] | false,
): LightningCSSOptions['targets'] {
  if (!esbuildTarget) {
    return {}
  }

  const cached = convertTargetsCache.get(esbuildTarget)

  if (cached) {
    return cached
  }

  const targets: LightningCSSOptions['targets'] = {}

  const entriesWithoutES = toArray(esbuildTarget).flatMap((entry) => {
    const match = entry.match(esREGEX)

    if (!match) {
      return entry
    }

    const target = esMap[Number(match[0])]

    if (!target) {
      throw new Error(`Unsupported target "${entry}"`)
    }

    return target
  })

  entriesWithoutES.forEach((entry) => {
    if (entry === 'esnext') {
      return
    }

    const version = entry.match(versionREGEX)

    if (!version) {
      throw new Error(`Unsupported target "${entry}"`)
    }

    const browser = map[entry.slice(0, version.index)]

    if (browser === false) {
      return
    }

    if (browser) {
      const [major = 0, minor = 0] = entry
        .slice(version.index)
        .split('.')
        .map((v) => parseInt(v, 10))

      if (!isNaN(major) && !isNaN(minor)) {
        const version = (major << 16) | (minor << 8)
        if (!targets[browser] || version < targets[browser]!) {
          targets[browser] = version
        }
        return
      }
    }
  })

  convertTargetsCache.set(esbuildTarget, targets)

  return targets
}
