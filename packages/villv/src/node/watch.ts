import glob from 'fast-glob'
import type { WatchOptions } from 'chokidar'
import type { ResolvedConfig } from './config.js'
import { toArray } from './utils.js'

const GIT_FILES = '**/.git/**'

const NODE_MODULES_FILES = '**/node_modules/**'

const PLAYWRIGHT_FILES = '**/test-results/**'

const defaultIgnoredFiles = [
  GIT_FILES,
  NODE_MODULES_FILES,
  PLAYWRIGHT_FILES,
] satisfies WatchOptions['ignored']

export function resolveChokidarOptions(
  config: ResolvedConfig,
  options: WatchOptions = {},
): WatchOptions {
  const { ignored = [], ...otherOptions } = options

  const resolvedChokidarOptions: WatchOptions = {
    ignored: [
      ...defaultIgnoredFiles,
      `${glob.escapePath(config.cacheDirectory)}/**`,
      ...toArray(ignored),
    ],
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ...otherOptions,
  }

  return resolvedChokidarOptions
}
