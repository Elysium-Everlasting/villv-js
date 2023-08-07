/**
 * This is different depending on whether this file is being run in the browser or NodeJS.
 *
 * In NodeJS, this information is used to absolutely resolve the file path,
 * i.e. for esbuild to find the correct entry point.
 *
 * This is a function to distinguish it from the props that will be defined with esbuild's `define` API,
 * which are JSON primitives, like strings and numbers.
 */
export const getThisUrl = () => new URL(import.meta.url)

/**----------------------------------------------------------------------------------
 * The following exports are props that will be defined with esbuild's `define` API.
 * @see https://esbuild.github.io/api/#define
 *
 * Like Svelte, exports from a file represent "props" that can be passed to it.
 *----------------------------------------------------------------------------------*/

/**
 * Only requests with the correct header can be upgraded to websocket connections.
 *
 * @example
 */
export declare const __HMR_HEADER__: string

export declare const __BASE__: string

/**
 * Host to connect to.
 *
 * @example
 */
export declare const __SERVER_HOST__: string

/**
 * The protocol used to connect to the websocket server. i.e. `ws` or `wss`.
 *
 * @example
 */
export declare const __HMR_PROTOCOL__: string | null

export declare const __HMR_HOSTNAME__: string | null

/**
 * Port that the main server is listening on (i.e. for all connections).
 *
 * @example
 */
export declare const __HMR_PORT__: number | null

export declare const __HMR_DIRECT_TARGET__: string

export declare const __HMR_BASE__: string

export declare const __HMR_TIMEOUT__: number

export declare const __HMR_ENABLE_OVERLAY__: boolean

//----------------------------------------------------------------------------------
// The following code is executed in the browser.
//----------------------------------------------------------------------------------

/**
 * Guess what it does!
 */
async function enableHotModuleReloading() {
  const importMetaUrl = getThisUrl()
  const socketProtocol = __HMR_PROTOCOL__ ?? (importMetaUrl.protocol === 'https:' ? 'wss' : 'ws')

  const hmrPort = __HMR_PORT__ || importMetaUrl.port

  const hostName = __HMR_HOSTNAME__ || importMetaUrl.hostname

  const socketHost = `${hostName}:${hmrPort}${__HMR_BASE__}`

  /**
   * Base URL to send messages?
   */
  // const base = __BASE__ || '/'

  /**
   * While the socket isn't ready, queue messages into a buffer.
   */
  // const messageBuffer: string[] = []

  const socket = new WebSocket(`${socketProtocol}://${socketHost}`, __HMR_HEADER__)

  socket.addEventListener('open', (ev) => {
    console.log('socket open', ev)
  })

  socket.addEventListener('message', (ev) => {
    console.log('data: ', JSON.parse(ev.data))
  })
}

if (typeof window !== 'undefined') {
  enableHotModuleReloading()
}
