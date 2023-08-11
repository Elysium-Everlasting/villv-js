import type http from 'node:http'
import type ProxyServer from 'http-proxy'

export interface ProxyOptions extends ProxyServer.ServerOptions {
  /**
   * Rewrite the path of the request before it is sent to the target.
   */
  rewrite?: (path: string) => string

  /**
   * Configure the proxy server.
   *
   * e.g. listen to events.
   */
  configure?: (proxy: ProxyServer, options: ProxyOptions) => void

  /**
   * Use a custom bypass function.
   */
  bypass?: ProxyBypass
}

/**
 * webpack-dev-server style bypass function.
 *
 * @see https://webpack.js.org/configuration/dev-server
 *
 * Return:
 * - null or undefined to continue processing the request with proxy.
 * - false to produce a 404 error for the request.
 * - string to represent a path to serve from, instead of continuing to proxy the request.
 */
export type ProxyBypass = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ProxyOptions,
) => void | null | undefined | false | string
