import type http from 'node:http'

export interface HmrOptions {
  /**
   * Protocol to use for the websocket connection.
   */
  protocol?: string

  /**
   * Hostname to use for the websocket connection.
   */
  host?: string

  /**
   * Port to use for the websocket connection.
   */
  port?: number

  /**
   * Port to use for the client connection.
   */
  clientPort?: number

  /**
   * You can put the websocket server at a sub-route?
   */
  path?: string

  /**
   * How often to ping the server.
   */
  timeout?: number

  /**
   * Whether to show an error overlay when a server error occurred while loading in the client.
   */
  overlay: boolean

  /**
   * The actual HTTP server?
   */
  server?: http.Server
}
