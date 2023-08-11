import type http from 'node:http'
import type https from 'node:https'
import type { CorsOptions } from 'cors'
import type { ProxyOptions } from './server/middlewares/proxy.js'

export interface CommonServerOptions {
  /**
   * Specify the server port.
   *
   * If the specified port is already in use, the next available port will be found and used.
   * This port may not be the one that the server ends up listening on.
   */
  port?: number

  /**
   * If `true`, the server will exit if the specified port is already in use.
   */
  strictPort?: boolean

  /**
   * Specify which IP addresses the server should listen on.
   *
   * Set to '0.0.0.0' to listen on all addresses, including LAN and public addresses.
   */
  host?: string | boolean

  /**
   * Enable TLS + HTTP/2.
   *
   * @remarks This downgrades to TLS only when the {@link proxy} option is also used.
   */
  https?: boolean | https.ServerOptions

  /**
   * Open the browser window on startup.
   *
   * @default false
   */
  open?: boolean | string

  /**
   * Configure custom proxy rules for the development server.
   * Uses [`http-proxy`](https://github.com/http-party/node-http-proxy).
   * Full options [here](https://github.com/http-party/node-http-proxy#options).
   *
   * Example configuration:
   *
   * ``` ts
   * module.exports = {
   *   proxy: {
   *     // string shorthand
   *     '/foo': 'http://localhost:4567/foo',
   *     // with options
   *     '/api': {
   *       target: 'http://jsonplaceholder.typicode.com',
   *       changeOrigin: true,
   *       rewrite: path => path.replace(/^\/api/, '')
   *     }
   *   }
   * }
   * ```
   */
  proxy?: Record<string, string | ProxyOptions>

  /**
   * Configure the CORS middlware.
   */
  cors?: CorsOptions

  /**
   * Specify server response headers.
   */
  headers?: http.OutgoingHttpHeaders
}
