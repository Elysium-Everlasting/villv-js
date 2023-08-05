import glob from 'fast-glob'
import type { WatchOptions } from 'chokidar'

/**
 * Directories that will always be ignored during watching.
 */
const defaultIgnoredDirectories = [
  /**
   * Git files.
   */
  '**/.git/**',

  /**
   * Node modules.
   */
  '**/node_modules/**',

  /**
   * ???
   */
  '**/test-results/**',
] satisfies WatchOptions['ignored']

export function resolveChokidarOptions(
  // config: ResolvedConfig,
  options: WatchOptions = {},
): WatchOptions {
  const { ignored = [], ...otherOptions } = options

  const resolvedOptions: WatchOptions = {
    ignored: [
      ...defaultIgnoredDirectories,
      glob.escapePath(/* config.cacheDir */ 'cache_directory') + '/**',
      ...(Array.isArray(ignored) ? ignored : [ignored]),
    ],
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ...otherOptions,
  }

  return resolvedOptions
}
