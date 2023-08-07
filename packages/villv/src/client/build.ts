import { build } from 'esbuild'
import { getThisUrl } from './client.js'
import type * as exports from './client.js'
import { CLIENT_OUTFILE } from '../constants.js'

type JsonPrimitive = string | number | boolean | null

type JsonProperties<T> = {
  [K in keyof T as T[K] extends JsonPrimitive ? K : never]: T[K]
}

function stringifyJsonProperties(json: NonNullable<unknown>) {
  return Object.entries(json).reduce(
    (acc, [key, value]) => {
      acc[key] = JSON.stringify(value)
      return acc
    },
    {} as Record<string, string>,
  )
}

export type Props = JsonProperties<typeof exports>

/**
 * Builds the client code that enables hot module reloading.
 *
 *
 * This function is intended to be used during development when the client may not be built yet.
 * Once published to NPM, the client code will be built and included in the package.
 */
export async function buildClient(props: Props) {
  const clientPath = getThisUrl().pathname

  await build({
    entryPoints: [clientPath],
    outfile: CLIENT_OUTFILE,
    define: stringifyJsonProperties(props),
  })
}
