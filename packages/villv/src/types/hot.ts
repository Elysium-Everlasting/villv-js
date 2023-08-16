import type { InferCustomEventPayload, MaybeCustomEventMapKey } from './customEvent.js'

export type ModuleNamespace = Record<string, unknown> & {
  /**
   * What's is this?
   */
  [Symbol.toStringTag]: 'Module'
}

/**
 * Why isn't this a class?
 */
export interface ViteHotContext {
  readonly data: unknown

  accept(): void
  accept(cb: (mod?: ModuleNamespace) => void): void
  accept(deps: readonly string[], cb: (mods?: (ModuleNamespace | undefined)[]) => void): void

  /**
   * Idk what this does.
   */
  acceptExports(exportNames: string | readonly string[], cb: (mod?: ModuleNamespace) => void): void

  /**
   * Idk what this does.
   */
  dispose(cb: (data: unknown) => void): void

  /**
   * Idk what this does.
   */
  prune(cb: (data: unknown) => void): void

  /**
   * Invalidates a module? Why is it only a string?
   */
  invalidate(message?: string): void

  /**
   * Subscribes to a type of message.
   */
  on<T extends MaybeCustomEventMapKey>(
    event: T,
    cb: (payload: InferCustomEventPayload<T>) => void,
  ): void

  /**
   * Sends a message.
   */
  send<T extends MaybeCustomEventMapKey>(event: T, payload?: InferCustomEventPayload<T>): void
}
