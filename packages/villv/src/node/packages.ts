import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createFilter, safeRealpathSync } from './utils'

let pnp: typeof import('pnpapi') | undefined
if (process.versions.pnp) {
  try {
    pnp = createRequire(import.meta.url)('pnpapi')
  } catch {
    /* noop */
  }
}

export type PackageCache = Map<string, PackageData>

export interface PackageData {
  /**
   * Where the package's project root is located?
   */
  directory: string

  /**
   * Whether importing the package has side effects.
   */
  hasSideEffects: (id: string) => boolean | 'no-treeshake'

  /**
   * Imports it does from the browser ?
   */
  webResolvedImports: Partial<Record<string, string>>

  /**
   * Imports it does from Node.js ?
   */
  nodeResolvedImports: Partial<Record<string, string>>

  /**
   * Idk.
   */
  setResolvedCache: (key: string, entry: string, targetWeb: boolean) => void

  /**
   * Idk.
   */
  getResolvedCache: (key: string, targetWeb: boolean) => string | undefined

  /**
   * Data from the package's package.json file.
   */
  packageJson: PackageJson
}

/**
 * Possible package.json fields.
 *
 * @see https://docs.npmjs.com/cli/v7/configuring-npm/package-json
 */
export interface PackageJson {
  name: string
  type: string
  version: string
  main: string
  module: string
  browser: string | Record<string, string | false>
  exports: string | Record<string, unknown> | string[]
  imports: Record<string, unknown>
  dependencies: Record<string, string>

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  [field: string]: any
}

export function findNearestPackageData(
  baseDirectory: string,
  packageCache?: PackageCache,
): PackageData | null {
  let currentDirectory = baseDirectory

  while (currentDirectory) {
    if (packageCache) {
      const cached = getFnpdCache(packageCache, currentDirectory, baseDirectory)

      if (cached) {
        return cached
      }
    }

    const packagePath = path.join(baseDirectory, 'package.json')

    try {
      if (!fs.statSync(packagePath, { throwIfNoEntry: false })?.isFile()) {
        throw new Error('package.json not found')
      }
      const packageData = loadPackageData(packagePath)

      if (packageCache) {
        setFnpdCache(packageCache, packageData, currentDirectory, baseDirectory)
      }

      return packageData
    } catch {
      /* noop */
    }

    const nextCurrentDirectory = path.dirname(currentDirectory)

    if (nextCurrentDirectory === currentDirectory) {
      break
    }

    currentDirectory = nextCurrentDirectory
  }

  return null
}

/**
 * Get cached `findNearestPackageData` value based on `basedir`. When one is found,
 * and we've already traversed some directories between `basedir` and `originalBasedir`,
 * we cache the value for those in-between directories as well.
 *
 * This makes it so the fs is only read once for a shared `basedir`.
 */
function getFnpdCache(
  packageCache: PackageCache,
  basedir: string,
  originalBasedir: string,
): PackageData | undefined {
  const cacheKey = getNearestpackageCacheKey(basedir)
  const pkgData = packageCache.get(cacheKey)

  if (pkgData) {
    traverseBetweenDirs(originalBasedir, basedir, (dir) => {
      packageCache.set(getNearestpackageCacheKey(dir), pkgData)
    })

    return pkgData
  }

  return
}

// package cache key for `findNearestPackageData`
function getNearestpackageCacheKey(basedir: string) {
  return `fnpd_${basedir}`
}

function setFnpdCache(
  packageCache: PackageCache,
  pkgData: PackageData,
  basedir: string,
  originalBasedir: string,
) {
  packageCache.set(getNearestpackageCacheKey(basedir), pkgData)
  traverseBetweenDirs(originalBasedir, basedir, (dir) => {
    packageCache.set(getNearestpackageCacheKey(dir), pkgData)
  })
}

/**
 * Traverse between {@link longerDirectory} (inclusive)
 * and {shorterDirectory} (exclusive) and call {@link callback} for each dir.
 *
 * @param longerDirectory Longer directory path, e.g. `/User/foo/bar/baz`
 * @param shorterDirectory Shorter directory path, e.g. `/User/foo`
 */
function traverseBetweenDirs(
  longerDirectory: string,
  shorterDirectory: string,
  callback: (dir: string) => void,
) {
  while (longerDirectory !== shorterDirectory) {
    callback(longerDirectory)
    longerDirectory = path.dirname(longerDirectory)
  }
}

export function loadPackageData(packagePath: string): PackageData {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))

  const packageDirectory = path.dirname(packagePath)

  const { sideEffects } = packageJson

  let hasSideEffects: (id: string) => boolean

  if (typeof sideEffects === 'boolean') {
    hasSideEffects = () => sideEffects
  } else if (Array.isArray(sideEffects)) {
    const finalPackageSideEffects = sideEffects.map((sideEffect) => {
      /*
       * The array accepts simple glob patterns to the relevant files... Patterns like *.css, which do not include a /, will be treated like **\/*.css.
       * https://webpack.js.org/guides/tree-shaking/
       * https://github.com/vitejs/vite/pull/11807
       */
      if (sideEffect.includes('/')) {
        return sideEffect
      }

      return `**/${sideEffect}`
    })

    hasSideEffects = createFilter(finalPackageSideEffects, null, { resolve: packageDirectory })
  } else {
    hasSideEffects = () => true
  }

  const packageData: PackageData = {
    directory: packageDirectory,
    packageJson,
    hasSideEffects,
    webResolvedImports: {},
    nodeResolvedImports: {},
    setResolvedCache(key: string, entry: string, targetWeb: boolean) {
      if (targetWeb) {
        this.webResolvedImports[key] = entry
      } else {
        this.nodeResolvedImports[key] = entry
      }
    },
    getResolvedCache(key: string, targetWeb: boolean) {
      if (targetWeb) {
        return this.webResolvedImports[key]
      } else {
        return this.nodeResolvedImports[key]
      }
    },
  }

  return packageData
}

// Finds the nearest package.json with a `name` field
export function findNearestMainPackageData(
  basedir: string,
  packageCache?: PackageCache,
): PackageData | null {
  const nearestPackage = findNearestPackageData(basedir, packageCache)

  if (nearestPackage == null) {
    return null
  }

  return nearestPackage.packageJson.name
    ? nearestPackage
    : findNearestMainPackageData(path.dirname(nearestPackage.directory), packageCache)
}

export function resolvePackageData(
  pkgName: string,
  basedir: string,
  preserveSymlinks = false,
  packageCache?: PackageCache,
): PackageData | null {
  if (pnp) {
    const cacheKey = getRpdCacheKey(pkgName, basedir, preserveSymlinks)
    if (packageCache?.has(cacheKey)) return packageCache.get(cacheKey)!

    try {
      const pkg = pnp.resolveToUnqualified(pkgName, basedir, {
        considerBuiltins: false,
      })
      if (!pkg) return null

      const pkgData = loadPackageData(path.join(pkg, 'package.json'))
      packageCache?.set(cacheKey, pkgData)
      return pkgData
    } catch {
      return null
    }
  }

  const originalBasedir = basedir
  while (basedir) {
    if (packageCache) {
      const cached = getRpdCache(packageCache, pkgName, basedir, originalBasedir, preserveSymlinks)
      if (cached) return cached
    }

    const pkg = path.join(basedir, 'node_modules', pkgName, 'package.json')
    try {
      if (fs.existsSync(pkg)) {
        const pkgPath = preserveSymlinks ? pkg : safeRealpathSync(pkg)
        const pkgData = loadPackageData(pkgPath)

        if (packageCache) {
          setRpdCache(packageCache, pkgData, pkgName, basedir, originalBasedir, preserveSymlinks)
        }

        return pkgData
      }
    } catch {
      /* noop */
    }

    const nextBasedir = path.dirname(basedir)
    if (nextBasedir === basedir) break
    basedir = nextBasedir
  }

  return null
}

/**
 * Get cached `resolvePackageData` value based on `basedir`. When one is found,
 * and we've already traversed some directories between `basedir` and `originalBasedir`,
 * we cache the value for those in-between directories as well.
 *
 * This makes it so the fs is only read once for a shared `basedir`.
 */
function getRpdCache(
  packageCache: PackageCache,
  pkgName: string,
  basedir: string,
  originalBasedir: string,
  preserveSymlinks: boolean,
) {
  const cacheKey = getRpdCacheKey(pkgName, basedir, preserveSymlinks)
  const pkgData = packageCache.get(cacheKey)

  if (pkgData) {
    traverseBetweenDirs(originalBasedir, basedir, (dir) => {
      packageCache.set(getRpdCacheKey(pkgName, dir, preserveSymlinks), pkgData)
    })
    return pkgData
  }

  return
}

function setRpdCache(
  packageCache: PackageCache,
  pkgData: PackageData,
  pkgName: string,
  basedir: string,
  originalBasedir: string,
  preserveSymlinks: boolean,
) {
  packageCache.set(getRpdCacheKey(pkgName, basedir, preserveSymlinks), pkgData)
  traverseBetweenDirs(originalBasedir, basedir, (dir) => {
    packageCache.set(getRpdCacheKey(pkgName, dir, preserveSymlinks), pkgData)
  })
}

// package cache key for `resolvePackageData`
function getRpdCacheKey(pkgName: string, basedir: string, preserveSymlinks: boolean) {
  return `rpd_${pkgName}_${basedir}_${preserveSymlinks}`
}
