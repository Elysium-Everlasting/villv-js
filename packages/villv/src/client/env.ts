//-----------------------------------------------------------------------------------
// Injected by esbuild's define API.
//-----------------------------------------------------------------------------------
declare const __MODE__: string

declare const __DEFINES__: Record<string, unknown>

const context =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : typeof window !== 'undefined'
    ? window
    : Function('return this')()

const defines = __DEFINES__

Object.keys(defines).forEach((key) => {
  const segments = key.split('.')

  let target = context

  let segment: string

  for (let i = 0; i < segments.length - 1; ++i) {
    segment = segments[i] ?? ''

    if (i === segments.length - 1) {
      target[segment] = defines[key]
    } else {
      target[segment] ??= {}
      target = target[segment]
    }
  }
})
