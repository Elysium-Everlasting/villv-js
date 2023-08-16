import type { ErrorPayload, FullReloadPayload, PrunePayload, UpdatePayload } from './hmrPayload.js'

/**
 * Can subscribe to these events in order to receive the corresponding payload.
 */
export interface CustomEventMap {
  'vite:beforeUpdate': UpdatePayload
  'vite:afterUpdate': UpdatePayload
  'vite:beforePrune': PrunePayload
  'vite:beforeFullReload': FullReloadPayload
  'vite:error': ErrorPayload
  'vite:invalidate': InvalidatePayload
  'vite:ws:connect': WebsocketConnectionPayload
  'vite:ws:disconnect': WebsocketConnectionPayload
}

/**
 * TODO: FIXME - Move this to `hmrPayload.ts` and export it from there?
 */
export interface WebsocketConnectionPayload {
  /**
   * @experimental
   */
  websocket: WebSocket
}

/**
 * TODO: FIXME - Move this to `hmrPayload.ts` and export it from there?
 */
export interface InvalidatePayload {
  path: string
  message?: string
}

/**
 * Utility type for inferring the payload type of a custom event.
 *
 * i.e. used in function signature for adding event listener.
 */
export type InferCustomEventPayload<T extends MaybeCustomEventMapKey> =
  T extends keyof CustomEventMap ? CustomEventMap[T] : unknown

export type MaybeCustomEventMapKey = keyof CustomEventMap | AutocompleteString

/**
 * Provides autocomplete on strings in a union.
 */
type AutocompleteString = string & NonNullable<unknown>
