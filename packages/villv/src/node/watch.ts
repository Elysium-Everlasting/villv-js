import type { WatchOptions } from 'chokidar'
import { escapePath } from 'fast-glob'

import { DEFAULT_CACHE_DIRECTORY } from './constants.js'
import { toArray } from './utils.js'

const GIT_FILES = '**/.git/**'

const NODE_MODULES_FILES = '**/node_modules/**'

const PLAYWRIGHT_FILES = '**/test-results/**'

const DEFAULT_IGNORED_FILES = [
  GIT_FILES,
  NODE_MODULES_FILES,
  PLAYWRIGHT_FILES,
] satisfies WatchOptions['ignored']

/**
 * Resolves the watch options.
 */
export function resolveChokidarOptions(
  cacheDirectory: string = DEFAULT_CACHE_DIRECTORY,
  options: WatchOptions = {},
): WatchOptions {
  const { ignored = [], ...otherOptions } = options

  const resolvedChokidarOptions: WatchOptions = {
    ignored: [...DEFAULT_IGNORED_FILES, `${escapePath(cacheDirectory)}/**`, ...toArray(ignored)],
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ...otherOptions,
  }

  return resolvedChokidarOptions
}
