import { DEFAULT_MAIN_FIELDS, DEFAULT_EXTENSIONS } from '../constants.js'

export interface ResolveOptions {
  /**
   * Files that are searched when resolving imports.
   *
   * @default {@link DEFAULT_MAIN_FIELDS}
   */
  mainFields?: string[]

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
