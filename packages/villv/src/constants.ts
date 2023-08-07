import path from 'node:path'
import { getClosestProjectDirectory } from './utils/project.js'
import packageJson from '../package.json'

const thisFileUrl = new URL(import.meta.url)

const thisProjectDirectory = getClosestProjectDirectory(thisFileUrl.pathname)

/**
 * The built client code for enabling hot module reloading in the browser.
 */
export const CLIENT_OUTFILE = path.join(thisProjectDirectory, 'dist', 'client.js')

/**
 * The import path used when importing the client code from the browser.
 *
 * It's distinguished from other types of imports.
 */
export const CLIENT_BROWSER_IMPORT = path.join('/', packageJson.name, 'client')
