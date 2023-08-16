import type { Logger } from './logger'

/**
 * TODO
 */
export interface BuildOptions {}

export interface ResolvedBuildOptions
  extends Required<Omit<BuildOptions, 'polyfillModulePreload'>> {
  modulePreload: false | ResolvedModulePreloadOptions
}

export interface ResolvedModulePreloadOptions {
  polyfill: boolean
  resolveDependencies?: ResolveModulePreloadDependenciesFn
}

export type ResolveModulePreloadDependenciesFn = (
  filename: string,
  deps: string[],
  context: {
    hostId: string
    hostType: 'html' | 'js'
  },
) => string[]

/**
 * TODO
 */
export function resolveBuildOptions(
  raw: BuildOptions | undefined,
  logger: Logger,
  root: string,
): ResolvedBuildOptions {
  raw
  logger
  root

  return {
    modulePreload: false,
  }
}

export type RenderBuiltAssetUrl = (
  filename: string,
  type: {
    type: 'asset' | 'public'
    hostId: string
    hostType: 'js' | 'css' | 'html'
    ssr: boolean
  },
) => string | { relative?: boolean; runtime?: string } | undefined
