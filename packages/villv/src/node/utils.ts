import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
// import url from 'node:url'
import crypto from 'node:crypto'
import { promises as dns } from 'node:dns'
import { exec } from 'node:child_process'
import { builtinModules, createRequire } from 'node:module'
import picocolors from 'picocolors'
import debug from 'debug'
import type { FSWatcher } from 'chokidar'
// import type MagicString from 'magic-string'
import type { BuildOptions } from 'esbuild'
// import type { TransformResult } from 'rollup'
import { createFilter, type FilterPattern } from '@rollup/pluginutils'
import type { Alias, RollupAliasOptions } from '@rollup/plugin-alias'
import {
  CLIENT_ENTRY,
  CLIENT_PUBLIC_PATH,
  ENV_PUBLIC_PATH,
  FS_PREFIX,
  NULL_BYTE_PLACEHOLDER,
  OPTIMIZABLE_ENTRY_REGEX,
  VALID_ID_PREFIX,
  wildcardHosts,
} from './constants.js'
import type { DecodedSourceMap, RawSourceMap } from '@ampproject/remapping'
import remapping from '@ampproject/remapping'
import type { ResolvedServerUrls } from './logger.js'

/**
 * TODO: move this somewhere else too.
 */

export interface Position {
  line: number
  column: number
}

/**
 * TODO: move somewhere else.
 */
type MaybePromise<T> = T | PromiseLike<T>

/**
 * Re-export.
 */
export type { FilterPattern }

/**
 * Re-export.
 */
export { createFilter }

/**
 * TODO: move this to src/node/optimizer/index.ts
 */
export interface DepOptimizationConfig {
  /**
   * Force optimize listed dependencies (must be resolvable import paths, cannot be globs).
   */
  include?: string[]

  /**
   * Do not optimize these dependencies (must be resolvable import paths, cannot be globs).
   */
  exclude?: string[]

  /**
   * Forces ESM interop when importing these dependencies.
   * Some legacy packages advertise themselves as ESM but use `require` internally
   *
   * @experimental
   */
  needsInterop?: string[]

  /**
   * Options to pass to esbuild during the dep scanning and optimization.
   *
   * Certain options are omitted since changing them would not be compatible with Vite's dep optimization.
   *
   * - `external` is also omitted, use Vite's `optimizeDeps.exclude` option
   * - `plugins` are merged with Vite's dep plugin
   *
   * https://esbuild.github.io/api
   */
  esbuildOptions?: Omit<
    BuildOptions,
    | 'bundle'
    | 'entryPoints'
    | 'external'
    | 'write'
    | 'watch'
    | 'outdir'
    | 'outfile'
    | 'outbase'
    | 'outExtension'
    | 'metafile'
  >

  /**
   * List of file extensions that can be optimized.
   * A corresponding esbuild plugin must exist to handle the specific extension.
   *
   * By default, Vite can optimize `.mjs`, `.js`, `.ts`, and `.mts` files.
   * This option allows specifying additional extensions.
   *
   * @experimental
   */
  extensions?: string[]

  /**
   * Disables dependencies optimizations, true disables the optimizer during build and dev.
   * Pass 'build' or 'dev' to only disable the optimizer in one of the modes.
   * Deps optimization is enabled by default in dev only.
   *
   * @default 'build'
   *
   * @experimental
   */
  disabled?: boolean | 'build' | 'dev'

  /**
   * Automatic dependency discovery.
   *
   * When `noDiscovery` is true, only dependencies listed in `include` will be optimized.
   * The scanner isn't run for cold start in this case.
   * CJS-only dependencies must be present in `include` during dev.
   *
   * @default false
   *
   * @experimental
   */
  noDiscovery?: boolean
}

/**
 * Windows uses backslashes for path separators, but Rollup expects forward.
 */
const windowsSlashRegex = /\\/g

/**
 * Convert Windows path separators to forward slashes if needed.
 */
export function normalizeSlash(filePath: string): string {
  return filePath.replace(windowsSlashRegex, '/')
}

/**
 * Prepend `/@id/` and replace null byte so the id is URL-safe.
 *
 * This is prepended to resolved ids that are not valid browser
 * import specifiers by the `importAnalysis` plugin.
 *
 * TODO: this isn't `wrapping`, it's more like encoding.
 */
export function wrapId(id: string): string {
  return id.startsWith(VALID_ID_PREFIX)
    ? id
    : `${VALID_ID_PREFIX}${id.replace('\0', NULL_BYTE_PLACEHOLDER)}`
}

/**
 * Undo {@link wrapId}'s `/@id/` and null byte replacements.
 *
 * TODO: this isn't `unwrapping`, it's more like decoding.
 */
export function unwrapId(id: string): string {
  return id.startsWith(VALID_ID_PREFIX)
    ? id.slice(VALID_ID_PREFIX.length).replace(NULL_BYTE_PLACEHOLDER, '\0')
    : id
}

const slashOrColonRegex = /[/:]/g
const dotRegex = /\./g
const nestedIdRegex = /(\s*>\s*)/g
const hashRegex = /#/g

/**
 * Flattening an ID removes all characters that are not valid in a browser?
 */
export function flattenId(id: string): string {
  return id
    .replace(slashOrColonRegex, '_')
    .replace(dotRegex, '__')
    .replace(nestedIdRegex, '___')
    .replace(hashRegex, '____')
}

/**
 * Nested IDs are flattened and separated by ` > `.
 */
export function normalizeId(id: string): string {
  return id.replace(nestedIdRegex, ' > ')
}

/**
 * TODO: revisit later to see if the edge case that "compiling using node v12 code to be run in node v16 in the server" is what we intend to support.
 */
const builtins = new Set([
  ...builtinModules,
  'assert/strict',
  'diagnostics_channel',
  'dns/promises',
  'fs/promises',
  'path/posix',
  'path/win32',
  'readline/promises',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'timers/promises',
  'util/types',
  'wasi',
])

/**
 * @example fs is the same as node:fs, where 'node:' just indicates that it's a builtin module.
 */
const NODE_BUILTIN_NAMESPACE = 'node:'

export function isBuiltin(id: string): boolean {
  /**
   * Trim the `node:` namespace if present.
   *
   * @example node:fs => fs
   */
  const moduleName = id.startsWith(NODE_BUILTIN_NAMESPACE)
    ? id.slice(NODE_BUILTIN_NAMESPACE.length)
    : id

  return builtins.has(moduleName)
}

/**
 * Whether the module was imported from the 'node_modules' directory.
 */
export function isInNodeModules(id: string): boolean {
  return id.includes('node_modules')
}

/**
 * Whether a module list contains a particular module.
 */
export function moduleListContains(moduleList: string[] = [], id: string): boolean {
  return moduleList.some((m) => m === id || id.startsWith(`${m}/`))
}

export function isOptimizable(id: string, optimizeDeps: DepOptimizationConfig): boolean {
  return (
    OPTIMIZABLE_ENTRY_REGEX.test(id) ||
    optimizeDeps.extensions?.some((ext) => id.endsWith(ext)) ||
    false
  )
}
export const bareImportREGEX = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/

export const deepImportREGEX = /^([^@][^/]*)\/|^(@[^/]+\/[^/]+)\//

/**
 * TODO: use import()
 *
 * How do I use that?
 */
const _require = createRequire(import.meta.url)

/**
 * Set in bin/vite.js
 */
const VITE_DEBUG_FILTER = process.env['VITE_DEBUG_FILTER']

const DEBUG = process.env['DEBUG']

/**
 * Something.
 */
interface DebuggerOptions {
  /**
   * If the debugger has multiple processes,
   * then only debug when the namespace follows the {@link ViteDebugScope} pattern.
   */
  onlyWhenFocused?: boolean | string
}

/**
 * A prefix is appended to the debug logs to indicate the source.
 *
 * For Vite-related processes, use the following structure.
 */
export type ViteDebugScope = `vite:${string}`

/**
 * Creates a debugger.
 */
export function createDebugger(
  namespace: ViteDebugScope,
  options: DebuggerOptions = {},
): debug.Debug['log'] | undefined {
  const log = debug(namespace)

  let enabled = log.enabled

  if (log.enabled && options.onlyWhenFocused) {
    const currentNamespace =
      typeof options.onlyWhenFocused === 'string' ? options.onlyWhenFocused : namespace

    enabled = !!DEBUG?.includes(currentNamespace)
  }

  if (!enabled) {
    return
  }

  return (...args: [string, ...any[]]) => {
    if (!VITE_DEBUG_FILTER || args.some((arg) => arg?.includes?.(VITE_DEBUG_FILTER))) {
      log(...args)
    }
  }
}

/**
 * Determines whether the file system is case-insensitive.
 */
function testCaseInsensitiveFs(): boolean {
  if (!CLIENT_ENTRY.endsWith('client.mjs')) {
    throw new Error(
      `cannot test case insensitive FS, CLIENT_ENTRY const doesn't contain client.mjs`,
    )
  }

  if (!fs.existsSync(CLIENT_ENTRY)) {
    throw new Error(
      'cannot test case insensitive FS, CLIENT_ENTRY does not point to an existing file: ' +
        CLIENT_ENTRY,
    )
  }

  return fs.existsSync(CLIENT_ENTRY.replace('client.mjs', 'cLiEnT.mjs'))
}

export function isUrl(maybeUrl: string): boolean {
  try {
    new URL(maybeUrl)
    return true
  } catch {
    return false
  }
}

export const isCaseInsensitiveFs = testCaseInsensitiveFs()

export const isWindows = os.platform() === 'win32'

const VOLUME_REGEX = /^[A-Z]:/i

export function normalizePath(id: string): string {
  return path.posix.normalize(isWindows ? normalizeSlash(id) : id)
}

/**
 * Return a normalized file path given a module's ID.
 */
export function filePathFromId(id: string): string {
  const filePath = normalizePath(id.startsWith(FS_PREFIX) ? id.slice(FS_PREFIX.length) : id)
  return filePath[0] === '/' || filePath.match(VOLUME_REGEX) ? filePath : `/${filePath}`
}

export function filePathFromUrl(url: string): string {
  return filePathFromId(cleanUrl(url))
}

/**
 * Check if a directory is a parent of file.
 *
 * Warning: parameters are not validated, only works with normalized absolute paths
 *
 * @param dir - normalized absolute path
 * @param file - normalized absolute path
 * @returns true if dir is a parent of file
 */
export function isParentDirectory(directory: string, file: string): boolean {
  const normalizedDirectory = directory.at(-1) === '/' ? directory : `${directory}/`

  return (
    file.startsWith(normalizedDirectory) ||
    (isCaseInsensitiveFs && file.toLowerCase().startsWith(normalizedDirectory.toLowerCase()))
  )
}

/**
 * Check if 2 file name are identical
 *
 * Warning: parameters are not validated, only works with normalized absolute paths
 *
 * @param file1 - normalized absolute path
 * @param file2 - normalized absolute path
 * @returns true if both files url are identical
 */
export function isSameFileUri(file1: string, file2: string): boolean {
  return file1 === file2 || (isCaseInsensitiveFs && file1.toLowerCase() === file2.toLowerCase())
}

export const queryRegex = /\?.*$/s

/**
 * A postfix is a query string appended to the end of a URL.
 * @example /foo/bar?postfix => /foo/bar
 */
const postfixRegex = /[?#].*$/s

export function cleanUrl(url: string): string {
  return url.replace(postfixRegex, '')
}

export const externalRegex = /^(https?:)?\/\//

export function isExternalUrl(url: string): boolean {
  return externalRegex.test(url)
}

export const dataUrlRegex = /^\s*data:/i

export function isDataUrl(url: string): boolean {
  return dataUrlRegex.test(url)
}

export const virtualModulePrefix = 'virtual-module:'

export const virtualModuleRegex = new RegExp(`/^${virtualModulePrefix}:.*/`)

const knownJsSrcRegex = /\.(?:[jt]sx?|m[jt]s|vue|marko|svelte|astro|imba)(?:$|\?)/

export function isJsRequest(url: string): boolean {
  const cleanedUrl = cleanUrl(url)

  if (knownJsSrcRegex.test(cleanedUrl)) {
    return true
  }

  if (!path.extname(cleanedUrl) && cleanedUrl.at(-1) !== '/') {
    return true
  }

  return false
}

const knownTsRegex = /\.(?:ts|mts|cts|tsx)(?:$|\?)/

export function isTsRequest(url: string): boolean {
  return knownTsRegex.test(url)
}

const importQueryRegex = /(\?|&)import=?(?:&|$)/

const directRequestRegex = /(\?|&)direct=?(?:&|$)/

const internalPrefixes = [FS_PREFIX, VALID_ID_PREFIX, CLIENT_PUBLIC_PATH, ENV_PUBLIC_PATH]

const internalPrefixRegex = new RegExp(`^(?:${internalPrefixes.join('|')})`)

const trailingSeparatorRegex = /[?&]$/

export function isImportRequest(url: string): boolean {
  return importQueryRegex.test(url)
}

export function isInternalRequest(url: string): boolean {
  return internalPrefixRegex.test(url)
}

export function removeImportQuery(url: string): string {
  return url.replace(importQueryRegex, '$1').replace(trailingSeparatorRegex, '')
}

export function removeDirectQuery(url: string): string {
  return url.replace(directRequestRegex, '$1').replace(trailingSeparatorRegex, '')
}

const percentageRegex = /%/g

export function injectQuery(url: string, queryToInject: string): string {
  const resolvedUrl = new URL(url.replace(percentageRegex, '%25'), 'relative:///')

  const pathname = cleanUrl(url)

  const normalizedPathname = isWindows ? normalizeSlash(pathname) : pathname
  const search = resolvedUrl.search ? `&` + resolvedUrl.search.slice(1) : ''
  const hash = resolvedUrl.hash ?? ''

  return `${normalizedPathname}?${queryToInject}${search}${hash}`
}

const timestampRegex = /\bt=\d{13}&?\b/

export function removeTimestampQuery(url: string): string {
  return url.replace(timestampRegex, '').replace(trailingSeparatorRegex, '')
}

/**
 * Asynchronously replaces all matches of a regular expression in a string.
 */
export async function asyncReplace(
  input: string,
  regex: RegExp,
  replacer: (match: RegExpExecArray) => MaybePromise<string>,
) {
  let match: RegExpExecArray | null
  let remaining = input
  let rewritten = ''

  while ((match = regex.exec(remaining))) {
    rewritten += remaining.slice(0, match.index)
    rewritten += await replacer(match)
    remaining = remaining.slice(match.index + match[0].length)
  }
}

export function timeFrom(start: number, subtract = 0): string {
  const time = performance.now() - start - subtract
  const timeString = `${time.toFixed(2)}ms`.padEnd(5, ' ')

  if (time < 10) {
    return picocolors.green(timeString)
  } else if (time < 50) {
    return picocolors.yellow(timeString)
  } else {
    return picocolors.red(timeString)
  }
}

/**
 * Format a URL prettily for logging.
 */
export function formatUrl(url: string, root: string): string {
  const trimmedUrl = removeTimestampQuery(url)

  const isAbsoluteFile = url.startsWith(root)

  if (isAbsoluteFile || url.startsWith(FS_PREFIX)) {
    const file = isAbsoluteFile ? trimmedUrl : filePathFromId(trimmedUrl)
    return picocolors.dim(path.relative(root, file))
  } else {
    return picocolors.dim(url)
  }
}

export function isObject(value: unknown): value is Record<PropertyKey, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function isDefined<T>(value: T): value is NonNullable<T> {
  return value != null
}

export function tryStatSync(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })
  } catch {
    // Fail silently.
    return
  }
}

export function lookupFile(directory: string, fileNames: string[]): string | undefined {
  let current = directory

  while (current) {
    for (const fileName of fileNames) {
      const file = path.join(directory, fileName)

      if (tryStatSync(file)?.isFile()) {
        return file
      }

      const parentDirectory = path.dirname(current)

      /**
       * Reached the root of the file system, so there are no more parent directories to search.
       */
      if (parentDirectory === current) {
        return
      }

      current = parentDirectory
    }
  }

  return
}

const newlineRegex = /\r?\n/

const range = 2

/**
 * Left-pads each line of a string with a given number of spaces.
 */
export function pad(source: string, n = range): string {
  const lines = source.split(newlineRegex)
  return lines.map((line) => ` `.repeat(n) + line).join(`\n`)
}

/**
 * Represents a position absolutely as a number.
 *
 * i.e. In order to restore the original {@link Position}, the number of newlines must be calculated.
 */
export function positionToNumber(source: string, position: number | Position): number {
  if (typeof position === 'number') {
    return position
  }

  /**
   * All the character up to the line before the last line.
   * The last line's number of characters corresponds to {@link Position.column}
   */
  const characters = source
    .split(newlineRegex)
    .slice(0, position.line - 1)
    .reduce((numCharacters, line) => numCharacters + line.length + 1, 0)

  return characters + position.column
}

/**
 * Converts an absolute number position back to the origin {@link Position} object.
 */
export function numberToPosition(source: string, offset: number | Position): Position {
  if (typeof offset !== 'number') {
    return offset
  }

  /**
   * Abort the calculation early if the absolute position is out of range.
   */
  if (offset > source.length) {
    throw new Error(
      `offset is longer than source length! offset ${offset} > length ${source.length}`,
    )
  }

  const lines = source.split(newlineRegex)

  let numCharacters = 0
  let line = 0
  let column = 0

  for (const currentLine of lines) {
    const lineLength = currentLine.length + 1

    if (numCharacters + lineLength > offset) {
      column = offset - numCharacters + 1
      break
    }

    numCharacters += lineLength
    line++
  }

  return { line, column }
}

export function generateCodeFrame(source: string, start: number | Position = 0, end?: number) {
  /**
   * Absolute starting position, represented as a number.
   */
  const startNum = positionToNumber(source, start)

  const endNum = end ?? startNum

  const lines = source.split(newlineRegex)

  const res: string[] = []

  let numCharacters = 0
  let i = 0

  for (const line of lines) {
    numCharacters += line.length + 1

    for (let j = i - range; j <= i + range || endNum > numCharacters; ++j) {
      if (j < 0 || j > lines.length) {
        continue
      }

      const lineNum = j + 1
      res.push(`${lineNum}${' '.repeat(Math.max(3 - String(lineNum).length, 0))}|  ${lines[j]}`)

      const lineLength = lines[j]?.length ?? 0

      if (j === i) {
        const pad = Math.max(startNum - (numCharacters - lineLength) + 1, 0)
        const length = Math.max(1, endNum > numCharacters ? lineLength - pad : endNum - startNum)
        res.push(`   |  ` + ' '.repeat(pad) + '^'.repeat(length))
      } else if (j > i) {
        const length = Math.max(Math.min(endNum - numCharacters, lineLength), 1)
        res.push(`   |  ` + '^'.repeat(length))
      }

      numCharacters += lineLength + 1
    }

    ++i
  }
}

const splitFirstDirectoryRegex = /(.+?)[\\/](.+)/

/**
 * Delete every file and subdirectory.
 *
 * __The given directory must exist__
 *
 * @param skip Optional, files to preserve under the root directory.
 */
export function emptyDirectory(directory: string, skip?: string[]): void {
  const skipInDirectory: string[] = []

  let nested: Map<string, string[]> | null = null

  if (skip?.length) {
    for (const file of skip) {
      if (path.dirname(file) === '.') {
        skipInDirectory.push(file)
      } else {
        const matched = file.match(splitFirstDirectoryRegex)

        if (!matched) {
          continue
        }

        const [, nestedDirectory, skippedFile] = matched

        if (!nestedDirectory) {
          continue
        }

        nested ??= new Map()

        const nestedSkippedFiles = nested.get(nestedDirectory) ?? []

        if (skippedFile != null && !nestedSkippedFiles.includes(skippedFile)) {
          nestedSkippedFiles.push(skippedFile)
          nested.set(nestedDirectory, nestedSkippedFiles)
        }
      }
    }
  }

  for (const file of fs.readdirSync(directory)) {
    if (skipInDirectory.includes(file)) {
      continue
    }
    if (nested?.has(file)) {
      emptyDirectory(path.relative(directory, file), nested.get(file))
    } else {
      fs.rmSync(path.resolve(directory, file), { recursive: true, force: true })
    }
  }
}

export function copyDirectory(sourceDirectory: string, destinationDirectory: string): void {
  fs.mkdirSync(destinationDirectory, { recursive: true })

  for (const file of fs.readdirSync(sourceDirectory)) {
    const sourceFile = path.resolve(sourceDirectory, file)

    if (sourceFile === destinationDirectory) {
      continue
    }

    const destinationFile = path.resolve(destinationDirectory, file)

    const stat = fs.statSync(sourceFile)

    if (stat.isDirectory()) {
      copyDirectory(sourceFile, destinationFile)
    } else {
      fs.copyFileSync(sourceFile, destinationFile)
    }
  }
}

/**
 * `fs.realpathSync.native` resolves differently in Windows network drive, causing file read errors.
 *
 * TODO: skip for now.
 *
 * @see https://github.com/nodejs/node/issues/37737
 */
export let safeRealpathSync = isWindows ? windowsSafeRealPathSync : fs.realpathSync.native

/**
 * @see https://github.com/larrybahr/windows-network-drive
 * MIT License, Copyright (c) 2017 Larry Bahr
 */
const windowsNetworkMap = new Map()

function windowsMappedRealpathSync(path: string) {
  const realPath = fs.realpathSync.native(path)

  if (realPath.startsWith('\\\\')) {
    for (const [network, volume] of windowsNetworkMap) {
      if (realPath.startsWith(network)) {
        return realPath.replace(network, volume)
      }
    }
  }

  return realPath
}

let firstSafeRealPathSyncRun = false

function windowsSafeRealPathSync(path: string): string {
  if (!firstSafeRealPathSyncRun) {
    optimizeSafeRealPathSync()
    firstSafeRealPathSyncRun = true
  }
  return fs.realpathSync(path)
}

const parseNetUseRegex = /^(\w+)? +(\w:) +([^ ]+)\s/

/**
 * Idk, some Windows shenanigans.
 */
function optimizeSafeRealPathSync() {
  /**
   * Skip if using Node <16.18 due to MAX_PATH
   * @see issue: https://github.com/vitejs/vite/issues/12931
   */
  const nodeVersion = process.versions.node.split('.').map(Number)

  if (nodeVersion[0] == null || nodeVersion[1] == null) {
    safeRealpathSync = fs.realpathSync
    return
  }

  if (nodeVersion[0] < 16 || (nodeVersion[0] === 16 && nodeVersion[1] < 18)) {
    safeRealpathSync = fs.realpathSync
    return
  }

  /**
   * Check the availability `fs.realpathSync.native`
   *
   * In Windows virtual and RAM disks that bypass the Volume Mount Manager,
   * in programs such as imDisk get the error EISDIR: illegal operation on a directory
   */
  try {
    fs.realpathSync.native(path.resolve('./'))
  } catch (error) {
    if ((error as Error).message.includes('EISDIR: illegal operation on a directory')) {
      safeRealpathSync = fs.realpathSync
      return
    }
  }

  exec('net use', (error, stdout) => {
    if (error) return
    const lines = stdout.split('\n')
    // OK           Y:        \\NETWORKA\Foo         Microsoft Windows Network
    // OK           Z:        \\NETWORKA\Bar         Microsoft Windows Network
    for (const line of lines) {
      const m = line.match(parseNetUseRegex)
      if (m) {
        windowsNetworkMap.set(m[3], m[2])
      }
    }
    if (windowsNetworkMap.size === 0) {
      safeRealpathSync = fs.realpathSync.native
    } else {
      safeRealpathSync = windowsMappedRealpathSync
    }
  })
}

export function ensureWatchedFile(watcher: FSWatcher, file: string | null, root: string): void {
  /**
   * File doesn't exist.
   */
  if (!file) {
    return
  }

  /**
   * If the file is already in the root directory (that's already being watched),
   * then it doesn't need to be added.
   */
  if (file.startsWith(root + '/')) {
    return
  }

  /**
   * Some rollup plugins use null bytes for private resolved IDs (i.e. virtual modules).
   *
   * These can't be watched since they don't exist on the file system.
   */
  if (file.includes('\0')) {
    return
  }

  /**
   * File doesn't exist, it can't be watched
   */
  if (!fs.existsSync(file)) {
    return
  }

  // Resolve file to normalized system path.
  watcher.add(path.resolve(file))
}

interface ImageCandidate {
  url: string
  descriptor: string
}

const escapedSpaceCharactersRegex = /( |\\t|\\n|\\f|\\r)+/g

const imageSetUrlRegex = /^(?:[\w\-]+\(.*?\)|'.*?'|".*?"|\S*)/

function reduceSrcset(srcSet: ImageCandidate[]) {
  return srcSet.reduce((prev, { url, descriptor = '' }, index) => {
    return (prev += url + ` ${descriptor}${index === srcSet.length - 1 ? '' : ', '}`)
  }, '')
}

function splitSrcSetDescriptor(srcSetDescriptor: string): ImageCandidate[] {
  return splitSrcSet(srcSetDescriptor)
    .map((s) => {
      const src = s.replace(escapedSpaceCharactersRegex, ' ').trim()
      const [url] = imageSetUrlRegex.exec(src) ?? ['']

      return {
        url,
        descriptor: src?.slice(url.length).trim(),
      }
    })
    .filter(({ url }) => !!url)
}

export const blankReplacer = (match: string): string => ' '.repeat(match.length)

const cleanSrcSetRegex =
  /(?:url|image|gradient|cross-fade)\([^)]*\)|"([^"]|(?<=\\)")*"|'([^']|(?<=\\)')*'/g

function splitSrcSet(srcs: string) {
  const parts: string[] = []

  /**
   * There could be a ',' inside of url(data:...), linear-gradient(...) or "data:..."
   */
  const cleanedSrcs = srcs.replace(cleanSrcSetRegex, blankReplacer)

  let startIndex = 0
  let splitIndex = 0

  do {
    splitIndex = cleanedSrcs.indexOf(',', startIndex)
    parts.push(srcs.slice(startIndex, splitIndex !== -1 ? splitIndex : undefined))
    startIndex++
  } while (splitIndex !== -1)

  return parts
}

export async function processSrcSet(
  srcs: string,
  replacer: (arg: ImageCandidate) => Promise<string>,
): Promise<string> {
  return Promise.all(
    splitSrcSetDescriptor(srcs).map(async ({ url, descriptor }) => ({
      url: await replacer({ url, descriptor }),
      descriptor,
    })),
  ).then((srcSet) => reduceSrcset(srcSet))
}

export function processSrcSetSync(srcs: string, replacer: (arg: ImageCandidate) => string): string {
  return reduceSrcset(
    splitSrcSetDescriptor(srcs).map(({ url, descriptor }) => ({
      url: replacer({ url, descriptor }),
      descriptor,
    })),
  )
}

const windowsDriveRegex = /^[A-Z]:/

const replaceWindowsDriveRegex = /^([A-Z]):\//

const linuxAbsolutePathRegex = /^\/[^/]/

const windowsPrefix = '/windows/'

const linuxPrefix = '/linux'

export function toUnixPath(path: string): string {
  if (windowsDriveRegex.test(path)) {
    return path.replace(replaceWindowsDriveRegex, `${windowsPrefix}$1`)
  }

  if (linuxAbsolutePathRegex.test(path)) {
    return `${linuxPrefix}{path}`
  }

  return path
}

const revertWindowsDriveRegex = /^\/windows\/([A-Z])\//

export function fromUnixPath(path: string): string {
  if (path.startsWith(`${linuxPrefix}/`)) {
    return path.slice(linuxPrefix.length)
  }

  if (path.startsWith(windowsPrefix)) {
    return path.replace(revertWindowsDriveRegex, '$1:/')
  }

  return path
}

/**
 * Empty source map if no sources found.
 */
const emptySourceMap: RawSourceMap = {
  names: [],
  sources: [],
  mappings: '',
  version: 3,
}

/**
 * @see https://github.com/sveltejs/svelte/blob/abf11bb02b2afbd3e4cac509a0f70e318c306364/src/compiler/utils/mapped_code.ts#L221
 */
export function combineSourceMaps(
  filename: string,
  sourcemapList: (DecodedSourceMap | RawSourceMap)[],
): RawSourceMap {
  if (!sourcemapList.length || sourcemapList.every((sourceMap) => !sourceMap.sources.length)) {
    return structuredClone(emptySourceMap)
  }

  /**
   * Hack to parse broken with normalized absolute paths on windows (C:/path/to/something).
   *
   * Escape them to linux like paths also avoid mutation here to prevent
   * breaking plugin's using cache to generate sourcemaps like vue (see #7442)
   */
  const normalizedSourcemapList = sourcemapList.map((sourcemap) => {
    const newSourcemaps = {
      ...sourcemap,
      sources: sourcemap.sources.map((source) => (source ? toUnixPath(source) : null)),
    }

    if (sourcemap.sourceRoot) {
      newSourcemaps.sourceRoot = toUnixPath(sourcemap.sourceRoot)
    }

    return newSourcemaps
  })

  const normalizedFilename = toUnixPath(filename)

  let mapIndex = 1

  const existingSource = normalizedSourcemapList
    .slice(0, -1)
    .find((sourceMap) => sourceMap.sources.length !== 1)

  const loader = (sourceFile: string) => {
    return sourceFile === normalizedFilename && normalizedSourcemapList[mapIndex]
      ? normalizedSourcemapList[mapIndex++]
      : null
  }

  const map =
    existingSource === undefined
      ? remapping(normalizedSourcemapList, () => null)
      : normalizedSourcemapList[0] != null
      ? remapping(normalizedSourcemapList[0], loader)
      : structuredClone(emptySourceMap)

  if (map.file == null) {
    delete map.file
  }

  map.sources = map.sources.map((source) => (source ? toUnixPath(source) : null))

  return map as RawSourceMap
}

/**
 * Remove duplicated items from array
 */
export function unique<T>(array: T[]): T[] {
  return Array.from(new Set(array))
}

/**
 * Returns resolved localhost address when `dns.lookup` result differs from DNS
 *
 * `dns.lookup` result is same when defaultResultOrder is `verbatim`.
 * Even if defaultResultOrder is `ipv4first`, `dns.lookup` result maybe same.
 * For example, when IPv6 is not supported on that machine/network.
 */

export async function getLocalhostAddressIfDifferentFromDns(): Promise<string | undefined> {
  const [nodeResult, dnsResult] = await Promise.all([
    dns.lookup('localhost'),

    /**
     * It says `verbatim` is true by default, wouldn't this be the same as the above?
     */
    dns.lookup('localhost', { verbatim: true }),
  ])

  const isSame = nodeResult.address === dnsResult.address && nodeResult.family === dnsResult.family

  return isSame ? undefined : nodeResult.address
}

export function diffDnsOrderChange(
  // oldUrls: ViteDevServer['resolvedUrls'],
  // newUrls: ViteDevServer['resolvedUrls'],
  oldUrls: ResolvedServerUrls | null,
  newUrls: ResolvedServerUrls | null,
): boolean {
  return !(
    oldUrls === newUrls ||
    (oldUrls &&
      newUrls &&
      arrayEqual(oldUrls.local, newUrls.local) &&
      arrayEqual(oldUrls.network, newUrls.network))
  )
}

export function arrayEqual(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left === right || left.every((item, index) => item === right[index])
}

export interface Hostname {
  /**
   * `undefined` sets the default behaviour of server.listen
   */
  host: string | undefined

  /**
   * Resolve to localhost when possible.
   */
  name: string
}

/**
 * Secure default.
 */
const defaultHost = 'localhost'

/**
 * If passed --host in the CLI without arguments.
 * `undefined` typically means 0.0.0.0 or :: (listen on all IPs)
 */
const listenAllHost = undefined

export async function resolveHostname(optionsHost?: string | boolean): Promise<Hostname> {
  const host = !optionsHost ? defaultHost : optionsHost === true ? listenAllHost : optionsHost

  /**
   * Set host name to localhost when possible
   */
  let name = host === undefined || wildcardHosts.has(host) ? 'localhost' : host

  if (host === 'localhost') {
    // See #8647 for more details.
    const localhostAddr = await getLocalhostAddressIfDifferentFromDns()
    if (localhostAddr) {
      name = localhostAddr
    }
  }

  return { host, name }
}

/**
 * TODO
 */
export async function resolveServerUrls() {}

export function toArray<T>(target: T | T[] = []): T[] {
  return Array.isArray(target) ? target : [target]
}

// Taken from https://stackoverflow.com/a/36328890
export const multilineCommentsRegex = /\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g
export const singlelineCommentsRegex = /\/\/.*/g
export const requestQuerySplitRegex = /\?(?!.*[/|}])/

// @ts-expect-error jest only exists when running Jest
export const usingDynamicImport = typeof jest === 'undefined'

/**
 * Dynamically import files. It will make sure it's not being compiled away by TS/Rollup.
 *
 * As a temporary workaround for Jest's lack of stable ESM support, we fallback to require
 * if we're in a Jest environment.
 * See https://github.com/vitejs/vite/pull/5197#issuecomment-938054077
 *
 * @param file File path to import.
 */
export const dynamicImport = usingDynamicImport
  ? new Function('file', 'return import(file)')
  : _require

export function parseRequest(id: string): Record<string, string> | null {
  const [_, search] = id.split(requestQuerySplitRegex, 2)

  if (!search) {
    return null
  }

  return Object.fromEntries(new URLSearchParams(search))
}

export function getHash(text: Buffer | string): string {
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 8)
}

/**
 * TODO
 */
// const _dirname = path.dirname(url.fileURLToPath(import.meta.url))
// export const requireResolveFromRootWithFallback = (root: string, id: string): string => {
//   // check existence first, so if the package is not found,
//   // it won't be cached by nodejs, since there isn't a way to invalidate them:
//   // https://github.com/nodejs/node/issues/44663
//   const found = resolvePackageData(id, root) || resolvePackageData(id, _dirname)
//   if (!found) {
//     const error = new Error(`${JSON.stringify(id)} not found.`)
//     ;(error as any).code = 'MODULE_NOT_FOUND'
//     throw error
//   }
//
//   // actually resolve
//   // Search in the root directory first, and fallback to the default require paths.
//   return _require.resolve(id, { paths: [root, _dirname] })
// }

export function emptyCssComments(raw: string): string {
  return raw.replace(multilineCommentsRegex, (s) => ' '.repeat(s.length))
}

export function removeComments(raw: string): string {
  return raw.replace(multilineCommentsRegex, '').replace(singlelineCommentsRegex, '')
}

export function mergeConfigRecursively<
  Defaults extends Record<PropertyKey, any>,
  Overrides extends Record<PropertyKey, any>,
>(
  defaults: Defaults extends Function ? never : Defaults,
  overrides: Overrides extends Function ? never : Overrides,
  rootPath: string,
) {
  const merged: Record<PropertyKey, any> = { ...defaults }

  Object.entries(overrides).forEach(([key, value]) => {
    if (value == null) {
      return
    }

    const existing = merged[key]

    if (existing == null) {
      merged[key] == value
      return
    }

    if (key === 'alias' && ['resolve', ''].includes(rootPath)) {
      merged[key] = mergeAlias(existing, value)
      return
    }

    if (key === 'assetsInclude' && rootPath === '') {
      merged[key] = [].concat(existing, value)
      return
    }

    if (key === 'noExternal' && rootPath === 'ssr' && (existing === true || value === true)) {
      merged[key] = true
      return
    }

    if (Array.isArray(existing) || Array.isArray(value)) {
      merged[key] = [...toArray(existing ?? []), ...toArray(value ?? [])]
      return
    }

    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeConfigRecursively(existing, value, rootPath ? `${rootPath}.${key}` : key)
      return
    }

    merged[key] = value
  })

  return merged
}

export function mergeConfig<
  Defaults extends Record<PropertyKey, any>,
  Overrides extends Record<PropertyKey, any>,
>(
  defaults: Defaults extends Function ? never : Defaults,
  overrides: Overrides extends Function ? never : Overrides,
  isRoot = true,
): Defaults & Overrides {
  if (typeof defaults === 'function' || typeof overrides === 'function') {
    throw new Error(`Cannot merge config in form of callback`)
  }
  return mergeConfigRecursively(defaults, overrides, isRoot ? '' : '.')
}

export function mergeAlias(
  left?: RollupAliasOptions['entries'],
  right?: RollupAliasOptions['entries'],
): RollupAliasOptions['entries'] | undefined {
  if (!left || !right) {
    return left || right
  }

  if (isObject(left) && isObject(right)) {
    return { ...left, ...right }
  }

  /**
   * The order is flipped because the alias is resolved from top-down,
   * where the later should have higher priority.
   */
  return [...normalizeAlias(right), ...normalizeAlias(left)]
}

/**
 * Idk.
 */
export function normalizeAlias(options: RollupAliasOptions['entries'] = []): Alias[] {
  return Array.isArray(options)
    ? options.map(normalizeSingleAlias)
    : Object.entries(options).map(([find, replacement]) =>
        normalizeSingleAlias({ find, replacement }),
      )
}

/**
 * Work-around for {@link https://github.com/rollup/plugins/issues/759}
 *
 * @see https://github.com/vitejs/vite/issues/1363
 */
function normalizeSingleAlias(alias: Alias): Alias {
  if (typeof alias.find !== 'string') {
    return alias
  }

  const startsWithSlash = alias.find.at(-1) === '/' && alias.replacement.at(-1) === '/'

  return {
    ...alias,
    find: startsWithSlash ? alias.find.slice(0, -1) : alias.find,
    replacement: startsWithSlash ? alias.replacement.slice(0, -1) : alias.replacement,
  }
}

/**
 * Transforms transpiled code result where line numbers aren't altered,
 * so we can skip sourcemap generation during dev.
 *
 * TODO
 */
// export function transformStableResult(
//   string: MagicString,
//   id: string,
//   config: any,
// ): TransformResult {}

/**
 * Flattens an array of (possible) promises.
 */
export async function asyncFlatten<T>(initialArray: T[]): Promise<T[]> {
  let flattenedArray: typeof initialArray

  do {
    flattenedArray = await Promise.all(initialArray).then((array) => array.flat(Infinity) as any)
  } while (flattenedArray.some((item: any) => item?.then))

  return flattenedArray
}

/**
 * Strips UTF-8 BOM.
 *
 * [Byte Order Mark](https://en.wikipedia.org/wiki/Byte_order_mark#UTF-8).
 */
export function stripBomTag(content: string) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

const windowsDrivePathPrefixRegex = /^[A-Za-z]:[/\\]/

/**
 * {@link path.isAbsolute} also returns true for drive relative paths on windows (e.g. /something)
 *
 * This function returns false for them but true for absolute paths (e.g. C:/something)
 */
export const isNonDriveRelativeAbsolutePath = (p: string): boolean => {
  return isWindows ? p[0] === '/' : windowsDrivePathPrefixRegex.test(p)
}

/**
 * Determine if a file is being requested with the correct case,
 * to ensure consistent behaviour between dev and prod and across operating systems.
 */
export function shouldServeFile(file: string, root: string): boolean {
  return isCaseInsensitiveFs ? true : hasCorrectCase(file, root)
}

/**
 * Determines if a file has the correct casing.
 *
 * Note that we can't use realpath here, because we don't want to follow symlinks.
 */
export function hasCorrectCase(file: string, assets: string): boolean {
  if (file === assets) {
    return true
  }

  const parent = path.dirname(file)

  if (fs.readdirSync(parent).includes(path.basename(file))) {
    return hasCorrectCase(parent, assets)
  }

  return false
}

/**
 * I feel that this can be accomplished more succinctly just with {@link path.relative}
 */
export function joinUrlSegments(left: string, right: string): string {
  if (!left || !right) {
    return left || right || ''
  }

  /**
   * Remove the trailing slash from the left side and the leading slash from the right side.
   */
  const paddedLeft = left.at(-1) === '/' ? left.slice(0, -1) : left
  const paddedRight = right[0] === '/' ? right : `/${right}`

  return `${paddedLeft}${paddedRight}`
}

export function removeLeadingSlash(str: string): string {
  return str[0] === '/' ? str.slice(1) : str
}

export function stripBase(path: string, base: string): string {
  if (path === base) {
    return '/'
  }
  const devBase = base.at(-1) === '/' ? base : `${base}/`
  return path.startsWith(devBase) ? path.slice(devBase.length) : path
}

export function evalValue<T = any>(rawValue: string): T {
  const fn = new Function(`
    var console, exports, global, module, process, require
    return (\n${rawValue}\n)
  `)
  return fn()
}

/**
 * Returns the package name of an import path.
 */
export function getNpmPackageName(importPath: string): string | null | undefined {
  const parts = importPath.split('/')

  // Scoped packages. e.g. @villv.js/vite
  if (parts[0]?.[0] === '@') {
    return parts[1] == null ? null : `${parts[0]}/${parts[1]}`
  } else {
    return parts[0]
  }
}

const escapeRegexRegex = /[-/\\^$*+?.()|[\]{}]/g

export function escapeRegex(str: string): string {
  return str.replace(escapeRegexRegex, '\\$&')
}

type CommandType = 'install' | 'uninstall' | 'update'

export function getPackageManagerCommand(type: CommandType = 'install'): string {
  const packageManager = process.env['npm_config_user_agent']?.split(' ')[0]?.split('/')[0] ?? 'npm'

  switch (type) {
    case 'install':
      return packageManager === 'npm' ? 'npm install' : `${packageManager} add`

    case 'uninstall':
      return packageManager === 'npm' ? 'npm uninstall' : `${packageManager} remove`

    case 'update':
      return packageManager === 'yarn' ? 'yarn upgrade' : `${packageManager} update`

    default:
      throw new TypeError(`Unknown command type: ${type}`)
  }
}
