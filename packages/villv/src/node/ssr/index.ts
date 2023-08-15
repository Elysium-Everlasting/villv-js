import type { DependencyOptimizationConfig } from '../optimizer'

export type SSRTarget = 'node' | 'webworker'

export type SSRFormat = 'esm' | 'cjs'

export type SSRDependencyOptimizationOptions = DependencyOptimizationConfig

export interface SSROptions {
  noExternal?: string | RegExp | (string | RegExp)[] | true

  external?: string[]

  target?: SSRTarget

  format?: SSRFormat

  optimizeDependencies?: SSRDependencyOptimizationOptions
}

type DefinedKeys<T, K extends keyof T = keyof T> = Omit<T, K> & Required<Pick<T, K>>

export type ResolvedSSROptions = DefinedKeys<
  SSROptions,
  'target' | 'format' | 'optimizeDependencies'
>

export function resolveSSROptions(
  ssr: SSROptions | undefined,
  preserveSymlinks: boolean,
  cjs?: boolean,
): ResolvedSSROptions {
  const optimizedDependencies = ssr?.optimizeDependencies ?? {}

  const format: SSRFormat = cjs ? 'cjs' : 'esm'

  const target: SSRTarget = 'node'

  return {
    format,
    target,
    ...ssr,
    optimizeDependencies: {
      disabled: true,
      ...optimizedDependencies,
      esbuildOptions: {
        preserveSymlinks,
        ...optimizedDependencies.esbuildOptions,
      },
    },
  }
}
