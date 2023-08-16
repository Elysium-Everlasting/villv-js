/**
 * Possible messages sent from the websocket server to the client.
 *
 * All payloads have a `type` property that can be used with type narrowing.
 */
export type HMRPayload =
  | ConnectedPayload
  | CustomPayload
  | ErrorPayload
  | FullReloadPayload
  | PrunePayload
  | UpdatePayload

/**
 * Sent after the websocket connection is established.
 */
export interface ConnectedPayload {
  type: 'connected'
}

/**
 * Custom payloads.
 */
export interface CustomPayload {
  type: 'custom'
  event: string
  data?: unknown
}

/**
 * Sent when an error occurs.
 */
export interface ErrorPayload {
  type: 'error'
  error: ErrorInfo
}

/**
 * Sent when a full reload is required.
 *
 * The client should refresh the browser.
 */
export interface FullReloadPayload {
  type: 'full-reload'
  path?: string
}

/**
 * Idk what prune means.
 */
export interface PrunePayload {
  type: 'prune'
  paths: string[]
}

/**
 * Send when certain files need to be re-imported because they have changed.
 *
 * Originates from {@link ModuleGraph}
 */
export interface UpdatePayload {
  type: 'update'
  updates: Update[]
}

/**
 * Information about an error.
 */
export interface ErrorInfo {
  [name: string]: unknown
  message: string
  stack: string
  id?: string
  frame?: string
  plugin?: string
  pluginCode?: string
  loc?: Loc
}

/**
 * Where the error occurred.
 */
export interface Loc {
  file?: string
  line: string
  column: number
}

/**
 * Information about the file that changed.
 */
export interface Update {
  type: 'js' | 'css'
  path: string
  acceptedPath: string
  timestamp: number

  /**
   * @experimental
   * @internal
   */
  explicitImportRequired?: boolean
}
