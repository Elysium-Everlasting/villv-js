import type { CommonServerOptions } from './http'
import type { ResolvedServerOptions } from './server'

export type PreviewOptions = CommonServerOptions

export type ResolvedPreviewOptions = PreviewOptions

export function resolvePreviewOptions(
  preview: PreviewOptions | undefined,
  server: ResolvedServerOptions,
) {
  // The preview server inherits every CommonServerOption from the `server` config
  // except for the port to enable having both the dev and preview servers running
  // at the same time without extra configuration

  return {
    ...preview,
    ...server,
  }
}
