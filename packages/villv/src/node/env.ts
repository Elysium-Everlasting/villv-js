import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'
import { toArray, tryStatSync } from './utils.js'
import type { UserConfig } from './config.js'
import { ENV_PREFIX } from './constants.js'

const defaultEnvFile = '.env'

const defaultLocalEnvFile = '.env.local'

export function loadEvn(
  mode: string,
  envDirectory: string,
  prefixes: string | string[] = ENV_PREFIX,
) {
  if (mode === 'local') {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with the .local postfix for .env files.`,
    )
  }

  const prefixArray = toArray(prefixes)

  const env: Record<PropertyKey, string> = {}

  const envFiles = [
    defaultEnvFile,
    defaultLocalEnvFile,
    `${defaultEnvFile}.${mode}` /** mode file */,
    `${defaultLocalEnvFile}.${mode}.local` /** mode local file */,
  ]

  const parsed = Object.fromEntries(
    envFiles.flatMap((file) => {
      const filePath = path.join(envDirectory, file)
      return !tryStatSync(filePath)?.isFile()
        ? []
        : Object.entries(parse(fs.readFileSync(filePath)))
    }),
  )

  /**
   * Test NODE_ENV override before expand as otherwise process.env.NODE_ENV would override this.
   */
  if (parsed['NODE_ENV'] && process.env['VITE_USER_NODE_ENV'] === undefined) {
    process.env['VITE_USER_NODE_ENV'] = parsed['NODE_ENV']
  }

  /**
   * Support BROWSER and BROWSER_ARGS env variables.
   */
  if (parsed['BROWSER'] && process.env['BROWSER'] === undefined) {
    process.env['BROWSER'] = parsed['BROWSER']
  }

  if (parsed['BROWSER_ARGS'] && process.env['BROWSER_ARGS'] === undefined) {
    process.env['BROWSER_ARGS'] = parsed['BROWSER_ARGS']
  }

  /**
   * Let environment variables use each other.
   * `expand` patched in patches/dotenv-expand@9.0.0.patch
   */
  expand({ parsed })

  /**
   * Only expose environment variables that start with the designated prefix.
   */
  Object.entries(parsed).forEach(([key, value]) => {
    if (prefixArray.some((prefix) => key.startsWith(prefix))) {
      env[key] = value
    }
  })

  /**
   * Check if there are actual env variables starting with the designated prefix.
   * These are typically provided inline and should have higher priority.
   */
  Object.entries(process.env).forEach(([key, value]) => {
    if (prefixArray.some((prefix) => key.startsWith(prefix)) && value != null) {
      env[key] = value
    }
  })

  return env
}

/**
 * Determine the env prefix, and warn if unsafe.
 */
export function resolveEnvPrefix(config: UserConfig): string[] {
  const envPrefix = toArray(config.envPrefix)

  if (envPrefix.some((prefix) => prefix === '')) {
    throw new Error(
      `envPrefix option contains value '', which could lead unexpected exposure of sensitive information.`,
    )
  }

  return envPrefix
}
