import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'
import { ENV_PREFIX } from './constants.js'
import { toArray, tryStatSync } from './utils.js'

const DEFAULT_ENV_FILE = '.env'

const DEFAULT_LOCAL_ENV_FILE = '.env.local'

export function loadEnv(
  mode: string,
  directory: string,
  prefixes: string | string[] = ENV_PREFIX,
): Record<string, string> {
  if (mode === 'local') {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with the .local postfix for .env files.`,
    )
  }

  const envFiles = [
    DEFAULT_ENV_FILE,
    DEFAULT_LOCAL_ENV_FILE,
    `${DEFAULT_ENV_FILE}.${mode}` /** mode file */,
    `${DEFAULT_LOCAL_ENV_FILE}.${mode}.local` /** mode local file */,
  ]

  const parsed = Object.fromEntries(
    envFiles
      .flatMap((file) => path.join(directory, file))
      .flatMap((filePath) =>
        !tryStatSync(filePath)?.isFile() ? [] : Object.entries(parse(fs.readFileSync(filePath))),
      ),
  )

  // Test NODE_ENV override before expand as otherwise process.env.NODE_ENV would override this.
  if (parsed['NODE_ENV'] && process.env['VITE_USER_NODE_ENV'] === undefined) {
    process.env['VITE_USER_NODE_ENV'] = parsed['NODE_ENV']
  }

  //  Support BROWSER and BROWSER_ARGS env variables.
  if (parsed['BROWSER'] && process.env['BROWSER'] === undefined) {
    process.env['BROWSER'] = parsed['BROWSER']
  }

  if (parsed['BROWSER_ARGS'] && process.env['BROWSER_ARGS'] === undefined) {
    process.env['BROWSER_ARGS'] = parsed['BROWSER_ARGS']
  }

  // Let environment variables use each other.
  // `expand` patched in patches/dotenv-expand@9.0.0.patch
  expand({ parsed })

  const prefixArray = toArray(prefixes)

  const env = Array.from([...Object.entries(parsed), ...Object.entries(process.env)]).reduce(
    (currentEnv, [key, value]) => {
      if (prefixArray.some((prefix) => key.startsWith(prefix)) && value != null) {
        currentEnv[key] = value
      }
      return currentEnv
    },
    {} as Record<string, string>,
  )

  return env
}

/**
 * Determine the env prefix, and warn if unsafe.
 */
export function resolveEnvPrefixes(envPrefix: string | string[]): string[] {
  const envPrefixes = toArray(envPrefix)

  if (envPrefixes.some((prefix) => prefix === '')) {
    throw new Error(
      `envPrefix option contains value '', which could lead unexpected exposure of sensitive information.`,
    )
  }

  return envPrefixes
}
