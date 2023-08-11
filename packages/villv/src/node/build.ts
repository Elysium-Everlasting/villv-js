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
  raw?: BuildOptions,
  logger: Logger,
  root: string,
): ResolvedBuildOptions {
  return {
    modulePreload: false,
  }
}
