import type {
  InferCustomEventPayload,
  InvalidatePayload,
  MaybeCustomEventMapKey,
} from '../types/customEvent.js'
import type { ErrorInfo, HMRPayload, Update } from '../types/hmrPayload.js'
import type { ModuleNamespace, ViteHotContext } from '../types/hot.js'

import { ErrorOverlay, overlayId } from './overlay.js'

interface HotModule {
  id: string
  callbacks: HotCallback[]
}

interface HotCallback {
  /**
   * The dependencies must be fetchable paths.
   */
  deps: string[]

  fn: (modules: (ModuleNamespace | undefined)[]) => void
}

//-----------------------------------------------------------------------------------
// Injected by esbuild's define API.
//-----------------------------------------------------------------------------------

declare const __BASE__: string

declare const __SERVER_HOST__: string

declare const __HMR_PROTOCOL__: string | null

declare const __HMR_HOSTNAME__: string | null

declare const __HMR_PORT__: number | null

declare const __HMR_DIRECT_TARGET__: string

declare const __HMR_BASE__: string

declare const __HMR_TIMEOUT__: number

declare const __HMR_ENABLE_OVERLAY__: boolean

//-----------------------------------------------------------------------------------
// Constants.
//-----------------------------------------------------------------------------------

const HMR_HEADER = 'vite-hmr'

const PING_HEADER = 'text/x-vite-ping'

const CLIENT_FILE = `@vite/client`

const PING_PAYLOAD = JSON.stringify({ type: 'ping' })

const importMetaUrl = new URL(import.meta.url)

const serverHost = __SERVER_HOST__

const serverProtocol = __HMR_PROTOCOL__ || (importMetaUrl.protocol === 'https:' ? 'wss' : 'ws')

const hmrPort = __HMR_PORT__ || importMetaUrl.port

const socketHostName = __HMR_HOSTNAME__ || importMetaUrl.hostname

const socketHost = `${socketHostName}:${hmrPort}${__HMR_BASE__}`

const directSocketHost = __HMR_DIRECT_TARGET__

const base = __BASE__ || '/'

const enableOverlay = __HMR_ENABLE_OVERLAY__

//-----------------------------------------------------------------------------------
// State.
//-----------------------------------------------------------------------------------

/**
 * Messages are queued in a buffer while the websocket connection isn't ready to be used.
 */
const messageBuffer: string[] = []

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const customListeners = new Map<string, ((data: any) => void)[]>()

const outdatedLinkTags = new WeakSet<HTMLLinkElement>()

const disposeMap = new Map<string, (data: unknown) => void | Promise<void>>()

const pruneMap = new Map<string, (data: unknown) => void | Promise<void>>()

const hotModulesMap = new Map<string, HotModule>()

const ctxToListenersMap = new Map<string, typeof customListeners>()

const dataMap = new Map<string, unknown>()

let pending = false

let queued: Promise<(() => void) | undefined>[] = []

let isFirstUpdate = true

let websocket: WebSocket

/**
 * Establish a websocket connection with the development server.
 * @param protocol The protocol to use for the websocket connection.
 * @param hostAndPath The host and path to connect to.
 * @param onCloseWithoutOpen Called when the websocket connection is closed before it is opened.
 */
function createWebsocket(protocol: string, hostAndPath: string, onCloseWithoutOpen?: () => void) {
  const websocket = new WebSocket(`${protocol}://${hostAndPath}`, HMR_HEADER)

  let isOpened = false

  websocket.addEventListener(
    'open',
    () => {
      isOpened = true
      notifyListeners('vite:ws:connect', { websocket })
    },
    {
      once: true,
    },
  )

  websocket.addEventListener('message', handleMessage)

  websocket.addEventListener('close', async (ev) => {
    if (ev.wasClean) {
      return
    }

    if (!isOpened && onCloseWithoutOpen != null) {
      onCloseWithoutOpen()
      return
    }

    notifyListeners('vite:ws:disconnect', { websocket })

    console.log(`[vite] server connection lost. polling for restart...`)

    await waitForSuccessfulPing(protocol, hostAndPath)

    location.reload()
  })

  return websocket
}

async function handleMessage(ev: MessageEvent) {
  const payload: HMRPayload = JSON.parse(ev.data)

  switch (payload.type) {
    case 'connected': {
      console.debug(`[vite] connected.`)

      sendMessageBuffer()

      // proxy (nginx, docker) hmr ws may have caused timeout,
      // so send ping package to keep ws connection alive.
      setInterval(() => {
        if (websocket.readyState === websocket.OPEN) {
          websocket.send(PING_PAYLOAD)
        }
      }, __HMR_TIMEOUT__)

      return
    }

    case 'update': {
      notifyListeners('vite:beforeUpdate', payload)

      // If this is the first update and there's already an error overlay,
      // this means the page opened with existing server compile error and the whole
      // module script failed to load (since one of the nested imports is 500).
      //
      // In this case a normal update won't work and a full reload is needed.
      if (isFirstUpdate && hasErrorOverlay()) {
        window.location.reload()
        return
      } else {
        clearErrorOverlay()
        isFirstUpdate = false
      }

      await Promise.all(
        payload.updates.map(async (update) => {
          if (update.type === 'js') {
            queueUpdate(fetchUpdate(update))
            return
          }

          const searchUrl = cleanUrl(update.path)

          // Can't use querySelector with `[href*=]` here since the link may be using relative paths.
          // So we need to use link.href to grab the full URL for the include check.
          const element = Array.from(document.querySelectorAll<HTMLLinkElement>('link')).find(
            (element) => {
              return !outdatedLinkTags.has(element) && cleanUrl(element.href).includes(searchUrl)
            },
          )

          if (!element) {
            return
          }

          const querySymbol = searchUrl.includes('?') ? '&' : '?'
          const newPath = `${base}${searchUrl.slice(1)}${querySymbol}t=${update.timestamp}`

          // Rather than swapping the href on the existing tag, we will create a new link tag.
          //
          // Once the new stylesheet has loaded we will remove the existing link tag.
          // This removes a Flash Of Unstyled Content (FoUC) that can occur when
          // swapping out the tag href directly, as the new stylesheet has not yet been loaded.
          return new Promise<void>((resolve) => {
            const newLinkTag = element.cloneNode() as HTMLLinkElement
            newLinkTag.href = new URL(newPath, element.href).href

            const removeOldElement = () => {
              element.remove()
              console.debug(`[vite] css hot updated: ${searchUrl}`)
              resolve()
            }

            newLinkTag.addEventListener('load', removeOldElement)
            newLinkTag.addEventListener('error', removeOldElement)

            outdatedLinkTags.add(newLinkTag)

            element.after(newLinkTag)
          })
        }),
      )

      return
    }

    case 'custom': {
      notifyListeners(payload.event, payload)
      return
    }

    case 'full-reload': {
      notifyListeners('vite:beforeFullReload', payload)

      if (!payload.path?.endsWith('.html')) {
        pageReload()
        return
      }

      const pagePath = decodeURI(location.pathname)

      const payloadPath = `${base}${payload.path.slice(1)}`

      if (
        pagePath === payloadPath ||
        payload.path === '/index.html' ||
        (pagePath.endsWith('/') && payloadPath === `${pagePath}index.html`)
      ) {
        pageReload()
      }

      return
    }

    case 'prune': {
      notifyListeners('vite:beforePrune', payload)

      // After an HMR update, some modules are no longer imported on the page
      // but they may have left behind side effects that need to be cleaned up. (.e.g style injections)
      // TODO: Trigger their dispose callbacks.
      payload.paths.forEach((path) => {
        pruneMap.get(path)?.(dataMap.get(path))
      })

      return
    }

    case 'error': {
      notifyListeners('vite:error', payload)

      if (enableOverlay) {
        createErrorOverlay(payload.error)
      } else {
        console.error(
          `[vite] Internal Server Error\n${payload.error.message}\n${payload.error.stack}`,
        )
      }

      return
    }

    default: {
      return payload
    }
  }
}

async function queueUpdate(promise: Promise<(() => void) | undefined>) {
  queued.push(promise)

  if (!pending) {
    pending = true

    await Promise.resolve()

    pending = false

    const loadingCallbacks = [...queued]

    queued = []

    await Promise.all(loadingCallbacks).then((callbacks) =>
      callbacks.forEach((callback) => callback?.()),
    )
  }
}

async function fetchUpdate(update: Update) {
  const mod = hotModulesMap.get(update.path)

  /**
   * In a code-splitting project,
   * it is common that the hot-updating module is not loaded yet.
   * https://github.com/vitejs/vite/issues/721
   */
  if (!mod) {
    return
  }

  let fetchedModule: ModuleNamespace | undefined

  const isSelfUpdate = update.path === update.acceptedPath

  const qualifiedCallbacks = mod.callbacks.filter((callback) =>
    callback.deps.includes(update.acceptedPath),
  )

  if (!isSelfUpdate || qualifiedCallbacks.length) {
    disposeMap.get(update.acceptedPath)?.(dataMap.get(update.acceptedPath))

    const [acceptedPath, query] = update.acceptedPath.split('?')

    try {
      const queryString = query ? `&${query}` : ''
      const explicit = update.explicitImportRequired ? 'import&' : ''

      fetchedModule = await import(
        `${base}${acceptedPath?.slice(1)}${explicit}t=${update.timestamp}${queryString}`
      )
    } catch (err) {
      warnFailedFetch(err as Error, update.acceptedPath)
    }
  }

  return () => {
    qualifiedCallbacks.forEach((callback) => {
      callback.fn(
        callback.deps.map((dep) => (dep === update.acceptedPath ? fetchedModule : undefined)),
      )

      const loggedPath = isSelfUpdate ? update.path : `${update.acceptedPath} via ${update.path}`

      console.debug(`[vite] hot updated: ${loggedPath}`)
    })
  }
}

function warnFailedFetch(err: Error, path: string | string[]) {
  if (!err.message.match('fetch')) {
    console.error(err)
  } else {
    console.error(
      `[hmr] Failed to reload ${path}. ` +
        `This could be due to syntax errors or importing non-existent ` +
        `modules. (see errors above)`,
    )
  }
}

function createErrorOverlay(error: ErrorInfo) {
  if (!enableOverlay) {
    return
  }

  clearErrorOverlay()

  document.body.appendChild(new ErrorOverlay(error))
}

function debounceReload(time: number) {
  let timer: ReturnType<typeof setTimeout> | null

  return () => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }

    timer = setTimeout(() => {
      location.reload()
    }, time)
  }
}

function pageReload() {
  return debounceReload(50)
}

function notifyListeners<T extends MaybeCustomEventMapKey>(
  event: T,
  data: InferCustomEventPayload<T>,
): void {
  const callbacks = customListeners.get(event)
  callbacks?.forEach((callback) => callback(data))
}

async function waitForSuccessfulPing(protocol: string, hostAndPath: string, interval = 1000) {
  const pingHostProtocol = protocol === 'wss' ? 'https' : 'http'

  const ping = async () => {
    return await fetch(`${pingHostProtocol}://${hostAndPath}`, {
      mode: 'no-cors',
      headers: {
        // Custom headers won't be included in a request with no-cors,
        // so (ab)use one of the safelisted headers to identify the ping request.
        Accept: PING_HEADER,
      },
    })
      .then(() => true)
      .catch(() => false)
  }

  if (await ping()) {
    return
  }

  await wait(interval)

  for (;;) {
    if (document.visibilityState === 'visible') {
      if (await ping()) {
        break
      }
      await wait(interval)
    } else {
      waitForWindowShow()
    }
  }
}

async function wait(interval: number): Promise<unknown> {
  return new Promise((resolve) => setTimeout(resolve, interval))
}

async function waitForWindowShow(): Promise<void> {
  return new Promise<void>((resolve) => {
    const onChange = async () => {
      if (document.visibilityState === 'visible') {
        resolve()
        document.removeEventListener('visibilitychange', onChange)
      }
    }
    document.addEventListener('visibilitychange', onChange)
  })
}

function sendMessageBuffer() {
  if (websocket.readyState === 1) {
    messageBuffer.forEach((msg) => websocket.send(msg))
    messageBuffer.length = 0
  }
}

function clearErrorOverlay() {
  document.querySelectorAll<ErrorOverlay>(overlayId).forEach((element) => element.close())
}

function hasErrorOverlay() {
  return document.querySelectorAll(overlayId).length
}

function cleanUrl(pathname: string): string {
  const url = new URL(pathname, location.toString())
  url.searchParams.delete('direct')
  return `${url.pathname}${url.search}`
}

/**
 * Utility function available to other modules participating with HMR stuff.
 */
export function createHotContext(ownerPath: string): ViteHotContext {
  if (!dataMap.has(ownerPath)) {
    dataMap.set(ownerPath, {})
  }

  /**
   * When a file is hot updated, a new context is created. Clear its stale callbacks.
   */
  const mod = hotModulesMap.get(ownerPath)

  if (mod) {
    mod.callbacks = []
  }

  const staleListeners = ctxToListenersMap.get(ownerPath)

  if (staleListeners) {
    staleListeners.forEach((staleFunctions, event) => {
      const listeners = customListeners.get(event)

      if (listeners) {
        customListeners.set(
          event,
          listeners.filter((listener) => !staleFunctions.includes(listener)),
        )
      }
    })
  }

  const newListeners: typeof customListeners = new Map()
  ctxToListenersMap.set(ownerPath, newListeners)

  function noop() {}

  function acceptDeps(deps: string[], callback: HotCallback['fn'] = noop) {
    const mod: HotModule = hotModulesMap.get(ownerPath) ?? { id: ownerPath, callbacks: [] }

    mod.callbacks.push({ deps, fn: callback })

    hotModulesMap.set(ownerPath, mod)
  }

  const hot: ViteHotContext = {
    get data() {
      return dataMap.get(ownerPath)
    },

    accept(deps?: unknown, callback?: HotCallback['fn']) {
      if (!deps) {
        acceptDeps([ownerPath], () => deps)
      } else if (typeof deps === 'function') {
        acceptDeps([ownerPath], ([mod]) => deps?.(mod))
      } else if (typeof deps === 'string') {
        acceptDeps([deps], ([mod]) => callback?.([mod]))
      } else if (Array.isArray(deps)) {
        acceptDeps(deps, callback)
      } else {
        throw new Error(`invalid hot.accept() usage.`)
      }
    },

    acceptExports(_exportNames, cb) {
      acceptDeps([ownerPath], ([mod]) => cb?.(mod))
    },

    dispose(cb) {
      disposeMap.set(ownerPath, cb)
    },

    prune(cb) {
      pruneMap.set(ownerPath, cb)
    },

    invalidate(message) {
      const payload: InvalidatePayload = { path: ownerPath, message }

      notifyListeners('vite:invalidate', payload)

      this.send('vite:invalidate', payload)

      console.debug(`[vite] invalidate ${ownerPath}${message ? `: ${message}` : ''}`)
    },

    on(event, cb) {
      const customEventListeners = newListeners.get(event) ?? []
      customEventListeners.push(cb)
      customListeners.set(event, customEventListeners)

      const newEventListeners = newListeners.get(event) ?? []
      newEventListeners.push(cb)
      newListeners.set(event, newEventListeners)
    },

    send(event, payload) {
      messageBuffer.push(JSON.stringify({ type: 'custom', event, data: payload }))
      sendMessageBuffer()
    },
  }

  return hot
}

async function main() {
  console.debug('[vite] connecting...')

  websocket = createWebsocket(serverProtocol, socketHost, () => {
    /**
     * If the initial attempt at establishing a websocket connection fails,
     * try connecting directly to the Vite HMR server.
     */
    websocket = createWebsocket(serverProtocol, directSocketHost, () => {
      const currentScriptHostUrl = new URL(import.meta.url)
      const currentScriptHost = `${
        currentScriptHostUrl.hostname
      }:${currentScriptHostUrl.pathname.replace(CLIENT_FILE, '')}`

      console.error(
        '[vite] failed to connect to websocket.\n' +
          'your current setup:\n' +
          `  (browser) ${currentScriptHost} <--[HTTP]--> ${serverHost} (server)\n` +
          `  (browser) ${socketHost} <--[WebSocket (failing)]--> ${directSocketHost} (server)\n` +
          'Check out your Vite / network configuration and https://vitejs.dev/config/server-options.html#server-hmr .',
      )
    })

    websocket.addEventListener(
      'open',
      () => {
        console.info(
          '[vite] Direct websocket connection fallback. Check out https://vitejs.dev/config/server-options.html#server-hmr to remove the previous connection error.',
        )
      },
      {
        once: true,
      },
    )
  })
}

main()

export { ErrorOverlay }
