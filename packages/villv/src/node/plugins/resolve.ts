import fs from 'node:fs'
import path from 'node:path'
import colors from 'picocolors'
import { exports, imports } from 'resolve.exports'
import { hasESMSyntax } from 'mlly'
import {
  DEFAULT_MAIN_FIELDS,
  DEFAULT_EXTENSIONS,
  OPTIMIZABLE_ENTRY_REGEX,
  SPECIAL_QUERY_REGEX,
  FS_PREFIX,
  DEPENDENCY_VERSION_REGEX,
  CLIENT_ENTRY,
  ENV_ENTRY,
} from '../constants.js'
import {
  findNearestMainPackageData,
  resolvePackageData,
  type PackageCache,
  type PackageData,
  findNearestPackageData,
  loadPackageData,
} from '../packages.js'
import {
  bareImportREGEX,
  cleanUrl,
  createDebugger,
  deepImportREGEX,
  filePathFromId,
  injectQuery,
  isBuiltin,
  isDataUrl,
  isExternalUrl,
  isInNodeModules,
  isNonDriveRelativeAbsolutePath,
  isObject,
  isOptimizable,
  isTsRequest,
  isWindows,
  normalizePath,
  safeRealpathSync,
  tryStatSync,
  type DependencyOptimizationConfig,
  normalizeSlash,
  getNpmPackageName,
} from '../utils.js'
import type { PartialResolvedId } from 'rollup'
import type { Plugin } from '../plugin.js'
import { optimizedDependencyInfoFromFile, type DependencyOptimizer } from '../optimizer/index.js'

const startsWithWordCharREGEX = /^\w/

export interface ResolveOptions {
  /**
   * Files that are searched when resolving imports.
   *
   * @default {@link DEFAULT_MAIN_FIELDS}
   */
  mainFields?: readonly string[]

  /**
   * @deprecated Use {@link mainFields} instead.
   * @default true
   */
  browserField?: boolean

  /**
   * I have no idea what conditions are for.
   */
  conditions?: string[]

  /**
   * The file extensions checked when resolving imports.
   *
   * @default {@link DEFAULT_EXTENSIONS}
   */
  extensions?: string[]

  /**
   * Idk what deduping is.
   */
  dedupe?: string[]

  /**
   * Whether to determine the file identity by using the original file path,
   * __before__ following symlinks, instead of the actual resolved file path,
   * which is found __after__ following symlinks.
   *
   * @default false
   */
  preserveSymlinks?: boolean
}

export interface InternalResolveOptions extends Required<ResolveOptions> {
  root: string
  isBuild: boolean
  isProduction: boolean

  /**
   * TODO
   */
  ssrConfig?: any // SSROptions

  packageCache?: PackageCache

  /**
   * src code mode also attempts the following:
   * - resolving /xxx as URLs
   * - resolving bare imports from optimized deps
   */
  asSrc?: boolean
  tryIndex?: boolean
  tryPrefix?: string
  preferRelative?: boolean
  isRequire?: boolean

  /**
   * #3040
   * When the importer is a ts module,
   * if the specifier requests a non-existent `.js/jsx/mjs/cjs` file,
   * should also try import from `.ts/tsx/mts/cts` source file as fallback.
   */
  isFromTsImporter?: boolean

  tryEsmOnly?: boolean

  // True when resolving during the scan phase to discover dependencies
  scan?: boolean

  /** Appends ?__vite_skip_optimization to the resolved id if shouldn't be optimized.
   */
  ssrOptimizeCheck?: boolean

  /**
   * Resolve using esbuild deps optimization
   * TODO
   */
  getDepsOptimizer?: any // (ssr: boolean) => DepsOptimizer | undefined

  shouldExternalize?: (id: string, importer?: string) => boolean | undefined

  /**
   * Set by createResolver, we only care about the resolved id. moduleSideEffects
   * and other fields are discarded so we can avoid computing them.
   * @internal
   */
  idOnly?: boolean
}

export type InternalResolveOptionsWithOverrideConditions = InternalResolveOptions & {
  /**
   * @internal
   */
  overrideConditions?: string[]
}

/**
 * special id for paths marked with browser: false
 * https://github.com/defunctzombie/package-browser-field-spec#ignore-a-module
 */
export const browserExternalId = '__vite-browser-external'

/**
 * Special id for packages that are optional peer deps.
 */
export const optionalPeerDepId = '__vite-optional-peer-dep'

const debug = createDebugger('vite:resolve-details', { onlyWhenFocused: true })

export function tryNodeResolve(
  id: string,
  importer: string | null | undefined,
  options: InternalResolveOptionsWithOverrideConditions,
  targetWeb: boolean,
  depsOptimizer?: any, // DepsOptimizer,
  ssr: boolean = false,
  externalize?: boolean,
  allowLinkedExternal: boolean = true,
): PartialResolvedId | undefined {
  const { root, dedupe, isBuild, preserveSymlinks, packageCache } = options

  // check for deep import, e.g. "my-lib/foo"
  const deepMatch = id.match(deepImportREGEX)

  const pkgId = deepMatch ? deepMatch[1] ?? deepMatch[2] ?? '' : id

  let basedir: string

  if (dedupe?.includes(pkgId)) {
    basedir = root
  } else if (
    importer &&
    path.isAbsolute(importer) &&
    // css processing appends `*` for importer
    (importer[importer.length - 1] === '*' || fs.existsSync(cleanUrl(importer)))
  ) {
    basedir = path.dirname(importer)
  } else {
    basedir = root
  }

  const pkg = resolvePackageData(pkgId, basedir, preserveSymlinks, packageCache)

  if (!pkg) {
    // if import can't be found, check if it's an optional peer dep.
    // if so, we can resolve to a special id that errors only when imported.
    if (
      basedir !== root && // root has no peer dep
      !isBuiltin(id) &&
      !id.includes('\0') &&
      bareImportREGEX.test(id)
    ) {
      const mainPkg = findNearestMainPackageData(basedir, packageCache)?.packageJson

      if (mainPkg) {
        if (mainPkg['peerDependencies']?.[id] && mainPkg['peerDependenciesMeta']?.[id]?.optional) {
          return {
            id: `${optionalPeerDepId}:${id}:${mainPkg.name}`,
          }
        }
      }
    }
    return
  }

  const resolveId = deepMatch ? resolveDeepImport : resolvePackageEntry

  const unresolvedId = deepMatch ? '.' + id.slice(pkgId.length) : pkgId

  let resolved: string | undefined

  try {
    resolved = resolveId(unresolvedId, pkg, targetWeb, options)
  } catch (err) {
    if (!options.tryEsmOnly) {
      throw err
    }
  }

  if (!resolved && options.tryEsmOnly) {
    resolved = resolveId(unresolvedId, pkg, targetWeb, {
      ...options,
      isRequire: false,
      mainFields: DEFAULT_MAIN_FIELDS,
      extensions: DEFAULT_EXTENSIONS,
    })
  }

  if (!resolved) {
    return
  }

  const processResult = (resolved: PartialResolvedId) => {
    if (!externalize) {
      return resolved
    }
    // don't external symlink packages
    if (!allowLinkedExternal && !isInNodeModules(resolved.id)) {
      return resolved
    }
    const resolvedExt = path.extname(resolved.id)
    // don't external non-js imports
    if (resolvedExt && resolvedExt !== '.js' && resolvedExt !== '.mjs' && resolvedExt !== '.cjs') {
      return resolved
    }

    let resolvedId = id

    if (deepMatch && !pkg?.packageJson.exports && path.extname(id) !== resolvedExt) {
      // id date-fns/locale
      // resolve.id ...date-fns/esm/locale/index.js
      const index = resolved.id.indexOf(id)
      if (index > -1) {
        resolvedId = resolved.id.slice(index)
        debug?.(`[processResult] ${colors.cyan(id)} -> ${colors.dim(resolvedId)}`)
      }
    }
    return { ...resolved, id: resolvedId, external: true }
  }

  // Resolve package side effects for build so that rollup can better perform tree-shaking
  if (!options.idOnly && ((!options.scan && isBuild && !depsOptimizer) || externalize)) {
    return processResult({
      id: resolved,
      moduleSideEffects: pkg.hasSideEffects(resolved),
    })
  }

  const ext = path.extname(resolved)

  if (
    !options.ssrOptimizeCheck &&
    (!isInNodeModules(resolved) || // linked
      !depsOptimizer || // resolving before listening to the server
      options.scan) // initial esbuild scan phase
  ) {
    return { id: resolved }
  }

  // if we reach here, it's a valid dep import that hasn't been optimized.
  const isJsType = depsOptimizer
    ? isOptimizable(resolved, depsOptimizer.options)
    : OPTIMIZABLE_ENTRY_REGEX.test(resolved)

  let exclude = depsOptimizer?.options.exclude
  let include = depsOptimizer?.options.include
  if (options.ssrOptimizeCheck) {
    // we don't have the depsOptimizer
    exclude = options.ssrConfig?.optimizeDeps?.exclude
    include = options.ssrConfig?.optimizeDeps?.include
  }

  const skipOptimization =
    depsOptimizer?.options.noDiscovery ||
    !isJsType ||
    (importer && isInNodeModules(importer)) ||
    exclude?.includes(pkgId) ||
    exclude?.includes(id) ||
    SPECIAL_QUERY_REGEX.test(resolved) ||
    // During dev SSR, we don't have a way to reload the module graph if
    // a non-optimized dep is found. So we need to skip optimization here.
    // The only optimized deps are the ones explicitly listed in the config.
    (!options.ssrOptimizeCheck && !isBuild && ssr) ||
    // Only optimize non-external CJS deps during SSR by default
    (ssr &&
      !(
        ext === '.cjs' ||
        (ext === '.js' &&
          findNearestPackageData(path.dirname(resolved), options.packageCache)?.packageJson.type !==
            'module')
      ) &&
      !(include?.includes(pkgId) || include?.includes(id)))

  if (options.ssrOptimizeCheck) {
    return {
      id: skipOptimization ? injectQuery(resolved, `__vite_skip_optimization`) : resolved,
    }
  }

  if (skipOptimization) {
    // excluded from optimization
    // Inject a version query to npm deps so that the browser
    // can cache it without re-validation, but only do so for known js types.
    // otherwise we may introduce duplicated modules for externalized files
    // from pre-bundled deps.
    if (!isBuild) {
      const versionHash = depsOptimizer!.metadata.browserHash
      if (versionHash && isJsType) {
        resolved = injectQuery(resolved, `v=${versionHash}`)
      }
    }
  } else {
    // this is a missing import, queue optimize-deps re-run and
    // get a resolved its optimized info
    const optimizedInfo = depsOptimizer!.registerMissingImport(id, resolved)
    resolved = depsOptimizer!.getOptimizedDepId(optimizedInfo)
  }

  if (!options.idOnly && !options.scan && isBuild) {
    // Resolve package side effects for build so that rollup can better
    // perform tree-shaking
    return {
      id: resolved ?? '',
      moduleSideEffects: pkg.hasSideEffects(resolved ?? ''),
    }
  } else {
    return { id: resolved! }
  }
}

function resolveDeepImport(
  id: string,
  { webResolvedImports, setResolvedCache, getResolvedCache, directory, packageJson }: PackageData,
  targetWeb: boolean,
  options: InternalResolveOptions,
): string | undefined {
  const cache = getResolvedCache(id, targetWeb)

  if (cache) {
    return cache
  }

  let relativeId: string | undefined | void = id

  const { exports: exportsField, browser: browserField } = packageJson

  // map relative based on exports data
  if (exportsField) {
    if (isObject(exportsField) && !Array.isArray(exportsField)) {
      // resolve without postfix (see #7098)
      const { file, postfix } = splitFileAndPostfix(relativeId)
      const exportsId = resolveExportsOrImports(packageJson, file, options, targetWeb, 'exports')
      if (exportsId !== undefined) {
        relativeId = exportsId + postfix
      } else {
        relativeId = undefined
      }
    } else {
      // not exposed
      relativeId = undefined
    }
    if (!relativeId) {
      throw new Error(
        `Package subpath '${relativeId}' is not defined by "exports" in ` +
          `${path.join(directory, 'package.json')}.`,
      )
    }
  } else if (targetWeb && options.browserField && isObject(browserField)) {
    // resolve without postfix (see #7098)
    const { file, postfix } = splitFileAndPostfix(relativeId)
    const mapped = mapWithBrowserField(file, browserField)
    if (mapped) {
      relativeId = mapped + postfix
    } else if (mapped === false) {
      return (webResolvedImports[id] = browserExternalId)
    }
  }

  if (relativeId) {
    const resolved = tryFsResolve(
      path.join(directory, relativeId),
      options,
      !exportsField, // try index only if no exports field
      targetWeb,
    )
    if (resolved) {
      debug?.(`[node/deep-import] ${colors.cyan(id)} -> ${colors.dim(resolved)}`)
      setResolvedCache(id, resolved, targetWeb)
      return resolved
    }
  }

  return
}

function splitFileAndPostfix(path: string) {
  const file = cleanUrl(path)
  return { file, postfix: path.slice(file.length) }
}

/**
 * given a relative path in pkg dir,
 * return a relative path in pkg dir,
 * mapped with the "map" object
 *
 * - Returning `undefined` means there is no browser mapping for this id
 * - Returning `false` means this id is explicitly externalized for browser
 */
function mapWithBrowserField(
  relativePathInPkgDir: string,
  map: Record<string, string | false>,
): string | false | undefined {
  const normalizedPath = path.posix.normalize(relativePathInPkgDir)

  for (const key in map) {
    const normalizedKey = path.posix.normalize(key)
    if (
      normalizedPath === normalizedKey ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '.js') ||
      equalWithoutSuffix(normalizedPath, normalizedKey, '/index.js')
    ) {
      return map[key]
    }
  }

  return
}

function equalWithoutSuffix(path: string, key: string, suffix: string) {
  return key.endsWith(suffix) && key.slice(0, -suffix.length) === path
}

export function tryFsResolve(
  fsPath: string,
  options: InternalResolveOptions,
  tryIndex = true,
  targetWeb = true,
  skipPackageJson = false,
): string | undefined {
  // Dependencies like es5-ext use `#` in their paths. We don't support `#` in user
  // source code so we only need to perform the check for dependencies.
  // We don't support `?` in node_modules paths, so we only need to check in this branch.
  const hashIndex = fsPath.indexOf('#')

  if (hashIndex >= 0 && isInNodeModules(fsPath)) {
    const queryIndex = fsPath.indexOf('?')
    // We only need to check foo#bar?baz and foo#bar, ignore foo?bar#baz
    if (queryIndex < 0 || queryIndex > hashIndex) {
      const file = queryIndex > hashIndex ? fsPath.slice(0, queryIndex) : fsPath
      const res = tryCleanFsResolve(file, options, tryIndex, targetWeb, skipPackageJson)
      if (res) return res + fsPath.slice(file.length)
    }
  }

  const { file, postfix } = splitFileAndPostfix(fsPath)

  const res = tryCleanFsResolve(file, options, tryIndex, targetWeb, skipPackageJson)

  if (res) {
    return res + postfix
  }

  return
}

export function resolvePackageEntry(
  id: string,
  { directory, packageJson, setResolvedCache, getResolvedCache }: PackageData,
  targetWeb: boolean,
  options: InternalResolveOptions,
): string | undefined {
  const cached = getResolvedCache('.', targetWeb)

  if (cached) {
    return cached
  }

  try {
    let entryPoint: string | undefined

    // resolve exports field with highest priority
    // using https://github.com/lukeed/resolve.exports
    if (packageJson.exports) {
      entryPoint = resolveExportsOrImports(packageJson, '.', options, targetWeb, 'exports')
    }

    const resolvedFromExports = !!entryPoint

    // if exports resolved to .mjs, still resolve other fields.
    // This is because .mjs files can technically import .cjs files which would
    // make them invalid for pure ESM environments - so if other module/browser
    // fields are present, prioritize those instead.
    if (targetWeb && options.browserField && (!entryPoint || entryPoint.endsWith('.mjs'))) {
      // check browser field
      // https://github.com/defunctzombie/package-browser-field-spec
      const browserEntry =
        typeof packageJson.browser === 'string'
          ? packageJson.browser
          : isObject(packageJson.browser) && packageJson.browser['.']
      if (browserEntry) {
        // check if the package also has a "module" field.
        if (
          !options.isRequire &&
          options.mainFields.includes('module') &&
          typeof packageJson.module === 'string' &&
          packageJson.module !== browserEntry
        ) {
          // if both are present, we may have a problem: some package points both
          // to ESM, with "module" targeting Node.js, while some packages points
          // "module" to browser ESM and "browser" to UMD/IIFE.
          // the heuristics here is to actually read the browser entry when
          // possible and check for hints of ESM. If it is not ESM, prefer "module"
          // instead; Otherwise, assume it's ESM and use it.
          const resolvedBrowserEntry = tryFsResolve(path.join(directory, browserEntry), options)
          if (resolvedBrowserEntry) {
            const content = fs.readFileSync(resolvedBrowserEntry, 'utf-8')
            if (hasESMSyntax(content)) {
              // likely ESM, prefer browser
              entryPoint = browserEntry
            } else {
              // non-ESM, UMD or IIFE or CJS(!!! e.g. firebase 7.x), prefer module
              entryPoint = packageJson.module
            }
          }
        } else {
          entryPoint = browserEntry
        }
      }
    }

    // fallback to mainFields if still not resolved
    // TODO: review if `.mjs` check is still needed
    if (!resolvedFromExports && (!entryPoint || entryPoint.endsWith('.mjs'))) {
      for (const field of options.mainFields) {
        if (field === 'browser') continue // already checked above
        if (typeof packageJson[field] === 'string') {
          entryPoint = packageJson[field]
          break
        }
      }
    }
    entryPoint ||= packageJson.main

    // try default entry when entry is not define
    // https://nodejs.org/api/modules.html#all-together
    const entryPoints = entryPoint ? [entryPoint] : ['index.js', 'index.json', 'index.node']

    for (let entry of entryPoints) {
      // make sure we don't get scripts when looking for sass
      let skipPackageJson = false
      if (options.mainFields[0] === 'sass' && !options.extensions.includes(path.extname(entry))) {
        entry = ''
        skipPackageJson = true
      } else {
        // resolve object browser field in package.json
        const { browser: browserField } = packageJson
        if (targetWeb && options.browserField && isObject(browserField)) {
          entry = mapWithBrowserField(entry, browserField) || entry
        }
      }

      const entryPointPath = path.join(directory, entry)
      const resolvedEntryPoint = tryFsResolve(entryPointPath, options, true, true, skipPackageJson)
      if (resolvedEntryPoint) {
        debug?.(`[package entry] ${colors.cyan(id)} -> ${colors.dim(resolvedEntryPoint)}`)
        setResolvedCache('.', resolvedEntryPoint, targetWeb)
        return resolvedEntryPoint
      }
    }
  } catch (e) {
    packageEntryFailure(id, (e as Error).message)
  }

  packageEntryFailure(id)

  return
}

function packageEntryFailure(id: string, details?: string) {
  throw new Error(
    `Failed to resolve entry for package "${id}". ` +
      `The package may have incorrect main/module/exports specified in its package.json` +
      (details ? ': ' + details : '.'),
  )
}

function resolveExportsOrImports(
  pkg: PackageData['packageJson'],
  key: string,
  options: InternalResolveOptionsWithOverrideConditions,
  targetWeb: boolean,
  type: 'imports' | 'exports',
) {
  const additionalConditions = new Set(
    options.overrideConditions || ['production', 'development', 'module', ...options.conditions],
  )

  const conditions = [...additionalConditions].filter((condition) => {
    switch (condition) {
      case 'production':
        return options.isProduction
      case 'development':
        return !options.isProduction
    }
    return true
  })

  const fn = type === 'imports' ? imports : exports

  const result = fn(pkg, key, {
    browser: targetWeb && !additionalConditions.has('node'),
    require: options.isRequire && !additionalConditions.has('import'),
    conditions,
  })

  return result ? result[0] : undefined
}

const knownTsOutputRE = /\.(?:js|mjs|cjs|jsx)$/
const isPossibleTsOutput = (url: string): boolean => knownTsOutputRE.test(url)

function tryCleanFsResolve(
  file: string,
  options: InternalResolveOptions,
  tryIndex = true,
  targetWeb = true,
  skipPackageJson = false,
): string | undefined {
  const { tryPrefix, extensions, preserveSymlinks } = options

  const fileStat = tryStatSync(file)

  // Try direct match first
  if (fileStat?.isFile()) return getRealPath(file, options.preserveSymlinks)

  let res: string | undefined

  // If path.dirname is a valid directory, try extensions and ts resolution logic
  const possibleJsToTs = options.isFromTsImporter && isPossibleTsOutput(file)
  if (possibleJsToTs || extensions.length || tryPrefix) {
    const dirPath = path.dirname(file)
    const dirStat = tryStatSync(dirPath)
    if (dirStat?.isDirectory()) {
      if (possibleJsToTs) {
        // try resolve .js, .mjs, .cjs or .jsx import to typescript file
        const fileExt = path.extname(file)
        const fileName = file.slice(0, -fileExt.length)
        if ((res = tryResolveRealFile(fileName + fileExt.replace('js', 'ts'), preserveSymlinks)))
          return res
        // for .js, also try .tsx
        if (fileExt === '.js' && (res = tryResolveRealFile(fileName + '.tsx', preserveSymlinks)))
          return res
      }

      if ((res = tryResolveRealFileWithExtensions(file, extensions, preserveSymlinks))) return res

      if (tryPrefix) {
        const prefixed = `${dirPath}/${options.tryPrefix}${path.basename(file)}`

        if ((res = tryResolveRealFile(prefixed, preserveSymlinks))) return res

        if ((res = tryResolveRealFileWithExtensions(prefixed, extensions, preserveSymlinks)))
          return res
      }
    }
  }

  if (tryIndex && fileStat) {
    // Path points to a directory, check for package.json and entry and /index file
    const dirPath = file

    if (!skipPackageJson) {
      let pkgPath = `${dirPath}/package.json`
      try {
        if (fs.existsSync(pkgPath)) {
          if (!options.preserveSymlinks) {
            pkgPath = safeRealpathSync(pkgPath)
          }
          // path points to a node package
          const pkg = loadPackageData(pkgPath)
          return resolvePackageEntry(dirPath, pkg, targetWeb, options)
        }
      } catch (e) {
        if ((e as any).code !== 'ENOENT') throw e
      }
    }

    if ((res = tryResolveRealFileWithExtensions(`${dirPath}/index`, extensions, preserveSymlinks)))
      return res

    if (tryPrefix) {
      if (
        (res = tryResolveRealFileWithExtensions(
          `${dirPath}/${options.tryPrefix}index`,
          extensions,
          preserveSymlinks,
        ))
      )
        return res
    }
  }

  return
}

function tryResolveRealFile(file: string, preserveSymlinks: boolean): string | undefined {
  const stat = tryStatSync(file)

  if (stat?.isFile()) {
    return getRealPath(file, preserveSymlinks)
  }

  return
}

function tryResolveRealFileWithExtensions(
  filePath: string,
  extensions: string[],
  preserveSymlinks: boolean,
): string | undefined {
  for (const ext of extensions) {
    const res = tryResolveRealFile(filePath + ext, preserveSymlinks)

    if (res) {
      return res
    }
  }

  return
}

function getRealPath(resolved: string, preserveSymlinks?: boolean): string {
  return normalizePath(
    !preserveSymlinks && browserExternalId !== resolved ? safeRealpathSync(resolved) : resolved,
  )
}

export function resolvePlugin(resolveOptions: InternalResolveOptions): Plugin {
  const { root, isProduction, asSrc, ssrConfig, preferRelative = false } = resolveOptions

  const { target: ssrTarget, noExternal: ssrNoExternal } = ssrConfig ?? {}

  // In unix systems, absolute paths inside root first needs to be checked as an
  // absolute URL (/root/root/path-to-file) resulting in failed checks before falling
  // back to checking the path as absolute. If /root/root isn't a valid path, we can
  // avoid these checks. Absolute paths inside root are common in user code as many
  // paths are resolved by the user. For example for an alias.
  const rootInRoot = tryStatSync(path.join(root, root))?.isDirectory() ?? false

  return {
    name: 'vite:resolve',

    async resolveId(id, importer, resolveOpts) {
      // When injected directly in html/client code
      if (id[0] === '\0' || id.startsWith('virtual:') || id.startsWith('/virtual:')) {
        return
      }

      const ssr = resolveOpts?.ssr === true

      // We need to delay depsOptimizer until here instead of passing it as an option
      // the resolvePlugin because the optimizer is created on server listen during dev
      const depsOptimizer = resolveOptions.getDepsOptimizer?.(ssr)

      if (id.startsWith(browserExternalId)) {
        return id
      }

      const targetWeb = !ssr || ssrTarget === 'webworker'

      // this is passed by @rollup/plugin-commonjs
      const isRequire: boolean = resolveOpts?.custom?.['node-resolve']?.isRequire ?? false

      const options: InternalResolveOptions = {
        isRequire,
        ...resolveOptions,
        scan: resolveOpts?.scan ?? resolveOptions.scan,
      }

      const resolvedImports = resolveSubpathImports(id, importer, options, targetWeb)

      if (resolvedImports) {
        id = resolvedImports

        if (resolveOpts.custom?.['vite:import-glob']?.isSubImportsPattern) {
          return id
        }
      }

      if (importer) {
        if (isTsRequest(importer) || resolveOpts.custom?.depScan?.loader?.startsWith('ts')) {
          options.isFromTsImporter = true
        } else {
          const moduleLang = this.getModuleInfo(importer)?.meta?.vite?.lang
          options.isFromTsImporter = moduleLang && isTsRequest(`.${moduleLang}`)
        }
      }

      let res: string | PartialResolvedId | undefined

      // resolve pre-bundled deps requests, these could be resolved by
      // tryFileResolve or /fs/ resolution but these files may not yet
      // exists if we are in the middle of a deps re-processing
      if (asSrc && depsOptimizer?.isOptimizedDepUrl(id)) {
        return id.startsWith(FS_PREFIX)
          ? filePathFromId(id)
          : normalizePath(path.resolve(root, id.slice(1)))
      }

      // explicit fs paths that starts with /@fs/*
      if (asSrc && id.startsWith(FS_PREFIX)) {
        res = filePathFromId(id)
        // We don't need to resolve these paths since they are already resolved
        // always return here even if res doesn't exist since /@fs/ is explicit
        // if the file doesn't exist it should be a 404.
        debug?.(`[@fs] ${colors.cyan(id)} -> ${colors.dim(res)}`)
        return ensureVersionQuery(res, id, options, depsOptimizer)
      }

      // URL
      // /foo -> /fs-root/foo
      if (asSrc && id[0] === '/' && (rootInRoot || !id.startsWith(root))) {
        const fsPath = path.resolve(root, id.slice(1))
        if ((res = tryFsResolve(fsPath, options))) {
          debug?.(`[url] ${colors.cyan(id)} -> ${colors.dim(res)}`)
          return ensureVersionQuery(res, id, options, depsOptimizer)
        }
      }

      // relative
      if (
        id[0] === '.' ||
        ((preferRelative || importer?.endsWith('.html')) && startsWithWordCharREGEX.test(id))
      ) {
        const basedir = importer ? path.dirname(importer) : process.cwd()
        const fsPath = path.resolve(basedir, id)
        // handle browser field mapping for relative imports

        const normalizedFsPath = normalizePath(fsPath)

        if (depsOptimizer?.isOptimizedDepFile(normalizedFsPath)) {
          // Optimized files could not yet exist in disk, resolve to the full path
          // Inject the current browserHash version if the path doesn't have one
          if (!resolveOptions.isBuild && !normalizedFsPath.match(DEPENDENCY_VERSION_REGEX)) {
            const browserHash = optimizedDependencyInfoFromFile(
              depsOptimizer.metadata,
              normalizedFsPath,
            )?.browserHash

            if (browserHash) {
              return injectQuery(normalizedFsPath, `v=${browserHash}`)
            }
          }
          return normalizedFsPath
        }

        if (
          targetWeb &&
          options.browserField &&
          (res = tryResolveBrowserMapping(fsPath, importer, options, true))
        ) {
          return res
        }

        if ((res = tryFsResolve(fsPath, options))) {
          res = ensureVersionQuery(res, id, options, depsOptimizer)
          debug?.(`[relative] ${colors.cyan(id)} -> ${colors.dim(res)}`)

          // If this isn't a script imported from a .html file, include side effects
          // hints so the non-used code is properly tree-shaken during build time.
          if (!options.idOnly && !options.scan && options.isBuild && !importer?.endsWith('.html')) {
            const resPkg = findNearestPackageData(path.dirname(res), options.packageCache)

            if (resPkg) {
              return {
                id: res,
                moduleSideEffects: resPkg.hasSideEffects(res),
              }
            }
          }
          return res
        }
      }

      // drive relative fs paths (only windows)
      if (isWindows && id[0] === '/') {
        const basedir = importer ? path.dirname(importer) : process.cwd()
        const fsPath = path.resolve(basedir, id)
        if ((res = tryFsResolve(fsPath, options))) {
          debug?.(`[drive-relative] ${colors.cyan(id)} -> ${colors.dim(res)}`)
          return ensureVersionQuery(res, id, options, depsOptimizer)
        }
      }

      // absolute fs paths
      if (isNonDriveRelativeAbsolutePath(id) && (res = tryFsResolve(id, options))) {
        debug?.(`[fs] ${colors.cyan(id)} -> ${colors.dim(res)}`)
        return ensureVersionQuery(res, id, options, depsOptimizer)
      }

      // external
      if (isExternalUrl(id)) {
        return options.idOnly ? id : { id, external: true }
      }

      // data uri: pass through (this only happens during build and will be
      // handled by dedicated plugin)
      if (isDataUrl(id)) {
        return null
      }

      // bare package imports, perform node resolve
      if (bareImportREGEX.test(id)) {
        const external = options.shouldExternalize?.(id, importer)
        if (
          !external &&
          asSrc &&
          depsOptimizer &&
          !options.scan &&
          (res = await tryOptimizedResolve(
            depsOptimizer,
            id,
            importer,
            options.preserveSymlinks,
            options.packageCache,
          ))
        ) {
          return res
        }

        if (
          targetWeb &&
          options.browserField &&
          (res = tryResolveBrowserMapping(id, importer, options, false, external))
        ) {
          return res
        }

        if (
          (res = tryNodeResolve(id, importer, options, targetWeb, depsOptimizer, ssr, external))
        ) {
          return res
        }

        // node built-ins.
        // externalize if building for SSR, otherwise redirect to empty module
        if (isBuiltin(id)) {
          if (ssr) {
            if (ssrNoExternal === true) {
              let message = `Cannot bundle Node.js built-in "${id}"`

              if (importer) {
                message += ` imported from "${path.relative(process.cwd(), importer)}"`
              }

              message += `. Consider disabling ssr.noExternal or remove the built-in dependency.`

              this.error(message)
            }

            return options.idOnly ? id : { id, external: true }
          } else {
            if (!asSrc) {
              debug?.(
                `externalized node built-in "${id}" to empty module. ` +
                  `(imported by: ${colors.white(colors.dim(importer))})`,
              )
            } else if (isProduction) {
              this.warn(
                `Module "${id}" has been externalized for browser compatibility, imported by "${importer}". ` +
                  `See http://vitejs.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.`,
              )
            }

            return isProduction ? browserExternalId : `${browserExternalId}:${id}`
          }
        }
      }

      debug?.(`[fallthrough] ${colors.dim(id)}`)
    },

    load(id) {
      if (id.startsWith(browserExternalId)) {
        if (isProduction) {
          return `export default {}`
        } else {
          id = id.slice(browserExternalId.length + 1)
          return `\
export default new Proxy({}, {
  get(_, key) {
    throw new Error(\`Module "${id}" has been externalized for browser compatibility. Cannot access "${id}.\${key}" in client code.  See http://vitejs.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.\`)
  }
})`
        }
      }
      if (id.startsWith(optionalPeerDepId)) {
        if (isProduction) {
          return `export default {}`
        } else {
          const [, peerDep, parentDep] = id.split(':')
          return `throw new Error(\`Could not resolve "${peerDep}" imported by "${parentDep}". Is it installed?\`)`
        }
      }
    },
  }
}

const normalizedClientEntry = normalizePath(CLIENT_ENTRY)
const normalizedEnvEntry = normalizePath(ENV_ENTRY)

function ensureVersionQuery(
  resolved: string,
  id: string,
  options: InternalResolveOptions,
  dependencyOptimizer: DependencyOptimizer,
) {
  if (
    !options.isBuild &&
    !options.scan &&
    dependencyOptimizer &&
    !(resolved === normalizedClientEntry || resolved === normalizedEnvEntry)
  ) {
    // Ensure that direct imports of node_modules have the same version query
    // as if they would have been imported through a bare import
    // Use the original id to do the check as the resolved id may be the real
    // file path after symlinks resolution
    const isNodeModule = isInNodeModules(id) || isInNodeModules(resolved)

    if (isNodeModule && !resolved.match(DEPENDENCY_VERSION_REGEX)) {
      const versionHash = dependencyOptimizer.metadata.browserHash

      if (versionHash && isOptimizable(resolved, dependencyOptimizer.options)) {
        return injectQuery(resolved, `v=${versionHash}`)
      }
    }
  }

  return resolved
}

const subpathImportsPrefix = '#'

function resolveSubpathImports(
  id: string,
  importer: string | undefined,
  options: InternalResolveOptions,
  targetWeb: boolean,
): string | undefined {
  if (!importer || !id.startsWith(subpathImportsPrefix)) {
    return
  }
  const baseDirectory = path.dirname(importer)
  const packageData = findNearestMainPackageData(baseDirectory, options.packageCache)

  if (!packageData) {
    return
  }

  let importsPath = resolveExportsOrImports(
    packageData.packageJson,
    id,
    options,
    targetWeb,
    'imports',
  )

  if (importsPath?.[0] === '.') {
    importsPath = path.relative(baseDirectory, path.join(packageData.directory, importsPath))

    if (importsPath[0] !== '.') {
      importsPath = `./${importsPath}`
    }
  }

  return importsPath
}

function tryResolveBrowserMapping(
  id: string,
  importer: string | undefined,
  options: InternalResolveOptions,
  isFilePath: boolean,
  externalize?: boolean,
): string | PartialResolvedId | undefined {
  let res: string | undefined

  const packageData =
    importer && findNearestMainPackageData(path.dirname(importer), options.packageCache)

  if (packageData && isObject(packageData.packageJson.browser)) {
    const mapId = isFilePath ? './' + normalizeSlash(path.relative(packageData.directory, id)) : id
    const browserMappedPath = mapWithBrowserField(mapId, packageData.packageJson.browser)

    if (browserMappedPath) {
      res = bareImportREGEX.test(browserMappedPath)
        ? tryNodeResolve(browserMappedPath, importer, options, true)?.id
        : tryFsResolve(path.join(packageData.directory, browserMappedPath), options)

      if (res != null) {
        debug?.(`[browser mapped] ${colors.cyan(id)} -> ${colors.dim(res)}`)

        let result: PartialResolvedId = { id: res }

        if (options.idOnly) {
          return result
        }

        if (!options.scan && options.isBuild) {
          const resPackageData = findNearestPackageData(path.dirname(res), options.packageCache)

          if (resPackageData) {
            result = {
              id: res,
              moduleSideEffects: resPackageData.hasSideEffects(res),
            }
          }
        }
        return externalize ? { ...result, external: true } : result
      }
    } else if (browserMappedPath === false) {
      return browserExternalId
    }
  }

  return
}

export async function tryOptimizedResolve(
  dependencyOptimizer: DependencyOptimizer,
  id: string,
  importer?: string,
  preserveSymlinks?: boolean,
  packageCache?: PackageCache,
): Promise<string | undefined> {
  // TODO: we need to wait until scanning is done here as this function
  // is used in the preAliasPlugin to decide if an aliased dep is optimized,
  // and avoid replacing the bare import with the resolved path.
  // We should be able to remove this in the future

  await dependencyOptimizer.scanProcessing

  const metadata = dependencyOptimizer.metadata

  const dependencyInfo = optimizedDependencyInfoFromFile(metadata, id)

  if (dependencyInfo) {
    return dependencyOptimizer.getOptimizedDepId(dependencyInfo)
  }

  if (!importer) {
    return
  }

  let idPackageDirectory: string | undefined

  const nestedIdMatch = `> ${id}`

  const matchingDependency = metadata.dependencyInfoList.find((optimizedData) => {
    // Ignore chunks.
    if (!optimizedData.src) {
      return false
    }

    // check where "foo" is nested in "my-lib > foo"
    if (!optimizedData.id.endsWith(nestedIdMatch)) {
      return false
    }

    // lazily initialize idPackageDirectory
    if (idPackageDirectory == null) {
      const packageName = getNpmPackageName(id)

      if (!packageName) {
        return false
      }

      const packageData = resolvePackageData(packageName, importer, preserveSymlinks, packageCache)

      if (packageData?.directory == null) {
        return false
      }

      idPackageDirectory = packageData.directory
    }

    // match by src to correctly identify if id belongs to nested dependency
    if (optimizedData.src.startsWith(idPackageDirectory)) {
      return true
    }

    return false
  })

  return matchingDependency ? dependencyOptimizer.getOptimizedDepId(matchingDependency) : undefined
}
