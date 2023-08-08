import path from 'node:path'
import { version } from '../../package.json'
import { getClosestProjectDirectory } from '../utils/project.js'

/**
 * Forward the version from this project's package.json
 *
 * Set during build time.
 */
export const VERSION = version

/**
 * I have no clue what these refer to.
 * Something in Rollup?
 */
export const DEFAULT_MAIN_FIELDS = [
  'module',
  'jsnext',
  /**
   * moment.js still uses this ... :(
   */
  'jsnext:main',
]

/**
 * Baseline support browserslist.
 * Higher browser versions may be needed for newer features.
 * "defaults and supports es6-module and supports es6-module-dynamic-import"
 */
export const ESBUILD_MODULES_TARGET = [
  /**
   * Supports import.meta.url
   */
  'es2020',
  'edge88',
  'firefox78',
  'chrome87',
  'safari14',
]

/**
 * Files that'll be resolved by Rollup?
 */
export const DEFAULT_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']

/**
 * Accepted config files.
 */
export const DEFAULT_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts',
]

/**
 * A JS or JSX file.
 */
export const JS_TYPES_REGEX = /\.(?:j|t)sx?$|\.mjs$/

/**
 * A CSS (or related) file.
 */
export const CSS_LANGS_REGEX = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/

/**
 * A regular JS file -> is optimizable?
 */
export const OPTIMIZABLE_ENTRY_REGEX = /\.[cm]?[jt]s$/

/**
 * Special imports are processed differently.
 */
export const SPECIAL_QUERY_REGEX = /[?&](?:worker|sharedworker|raw|url)\b/

/**
 * Prefix used for request for JS files directly from the file system.
 * i.e. The server should respond with the file's content.
 */
export const FS_PREFX = `/@fs/`

/**
 * Prefix for resolved IDs that aren't valid browser import specifiers.
 */
export const VALID_ID_PREFIX = `/@id/`

/**
 * Plugins that use 'virtual modules' (e.g. for helper functions),
 * prefix the module ID with `\0`, a convention from the rollup ecosystem.
 *
 * @see https://rollupjs.org/plugin-development/#conventions
 *
 * This prevents other plugins from trying to process the id (like node resolution),
 * and core features like sourcemaps can use this info to differentiate between
 * virtual modules and regular files.
 *
 * `\0` is not a permitted char in import URLs so we have to replace them during import analysis.
 * The id will be decoded back before entering the plugins pipeline.
 *
 * These encoded virtual ids are also prefixed by the VALID_ID_PREFIX,
 * so virtual modules in the browser end up encoded as `/@id/__x00__{id}`
 */
export const NULL_BYTE_PLACEHOLDER = `__x00__`

/**
 * Request path for a special `client.js` module (browser only).
 *
 * This `client.js` file is injected in a script tag in HTML template by the dev server
 * in order to establish a websocket connection and receive HMR updates.
 */
export const CLIENT_PUBLIC_PATH = `/@vite/client`

/**
 * Request path for a special `env.js` module (browser only).
 *
 * If environment variables need to be defined in the browser,
 * this module will inject them into the `import.meta.env` object.
 */
export const ENV_PUBLIC_PATH = `/@vite/env`

/**
 * The special `client.js` and `env.js` modules have to be dynamically compiled based on the config.
 *
 * We'll build it in this package's `dist/client` directory.
 *
 * TODO: In my own package, I'd like to expost this to the consumer in the cache directory.
 */
export const VITE_PACKAGE_DIRECTORY = getClosestProjectDirectory(new URL(import.meta.url).href)

/**
 * The location of the dynamically built `client.js` module.
 */
export const CLIENT_ENTRY = path.resolve(
  VITE_PACKAGE_DIRECTORY,
  path.join('dist', 'client', 'client.mjs'),
)

/**
 * The location of the dynamically built `env.js` module.
 */
export const ENV_ENTRY = path.resolve(
  VITE_PACKAGE_DIRECTORY,
  path.join('dist', 'client', 'env.mjs'),
)

/**
 * The directory to find the special browser modules.
 */
export const CLIENT_DIRECTORY = path.dirname(CLIENT_ENTRY)

/**
 * __READ THIS__
 *
 * Before editing `KNOWN_ASSET_TYPES` ...
 *
 * If you add an asset to `KNOWN_ASSET_TYPES`, make sure to also add it to the
 * TypeScript declaration file `packages/vite/client.d.ts`, and add a mime type
 * to the `registerCustomMime` in `packages/vite/src/node/plugin/assets.ts`
 * if mime type cannot be looked up by mrmime.
 */
export const KNOWN_ASSET_TYPES = [
  // images
  'apng',
  'png',
  'jpe?g',
  'jfif',
  'pjpeg',
  'pjp',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',

  // media
  'mp4',
  'webm',
  'ogg',
  'mp3',
  'wav',
  'flac',
  'aac',
  'opus',

  // fonts
  'woff2?',
  'eot',
  'ttf',
  'otf',

  // other
  'webmanifest',
  'pdf',
  'txt',
]

/**
 * Regex for matching asset files.
 */
export const DEFAULT_ASSETS_REGEX = new RegExp(`\\.(` + KNOWN_ASSET_TYPES.join('|') + `)(\\?.*)?$`)

/**
 * Idk what this is for.
 */
export const DEPENDENCY_VERSION_REGEX = /[?&](v=[\w.-]+)\b/

/**
 * Loopback hosts.
 */
export const loopbackHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
])

/**
 * Wildcard hosts.
 */
export const wildcardHosts = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000'])

/**
 * Port to use for dev server.
 */
export const DEFAULT_DEV_PORT = 5173

/**
 * Port to use for preview server.
 */
export const DEFAULT_PREVIEW_PORT = 4173