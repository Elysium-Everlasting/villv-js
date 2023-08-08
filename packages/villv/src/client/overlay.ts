import type { ErrorInfo, ErrorPayload } from '../types/hmrPayload.js'

/**
 * Injected by esbuild.
 */
declare const __BASE__: string

const base = __BASE__ || '/'

const template = `
<style>
:host {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 99999;
  --monospace: 'SFMono-Regular', Consolas,
  'Liberation Mono', Menlo, Courier, monospace;
  --red: #ff5555;
  --yellow: #e2aa53;
  --purple: #cfa4ff;
  --cyan: #2dd9da;
  --dim: #c9c9c9;

  --window-background: #181818;
  --window-color: #d8d8d8;
}

.backdrop {
  position: fixed;
  z-index: 99999;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow-y: scroll;
  margin: 0;
  background: rgba(0, 0, 0, 0.66);
}

.window {
  font-family: var(--monospace);
  line-height: 1.5;
  width: 800px;
  color: var(--window-color);
  margin: 30px auto;
  padding: 25px 40px;
  position: relative;
  background: var(--window-background);
  border-radius: 6px 6px 8px 8px;
  box-shadow: 0 19px 38px rgba(0,0,0,0.30), 0 15px 12px rgba(0,0,0,0.22);
  overflow: hidden;
  border-top: 8px solid var(--red);
  direction: ltr;
  text-align: left;
}

pre {
  font-family: var(--monospace);
  font-size: 16px;
  margin-top: 0;
  margin-bottom: 1em;
  overflow-x: scroll;
  scrollbar-width: none;
}

pre::-webkit-scrollbar {
  display: none;
}

.message {
  line-height: 1.3;
  font-weight: 600;
  white-space: pre-wrap;
}

.message-body {
  color: var(--red);
}

.plugin {
  color: var(--purple);
}

.file {
  color: var(--cyan);
  margin-bottom: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.frame {
  color: var(--yellow);
}

.stack {
  font-size: 13px;
  color: var(--dim);
}

.tip {
  font-size: 13px;
  color: #999;
  border-top: 1px dotted #999;
  padding-top: 13px;
  line-height: 1.8;
}

code {
  font-size: 13px;
  font-family: var(--monospace);
  color: var(--yellow);
}

.file-link {
  text-decoration: underline;
  cursor: pointer;
}

kbd {
  line-height: 1.5;
  font-family: ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  font-weight: 700;
  background-color: rgb(38, 40, 44);
  color: rgb(166, 167, 171);
  padding: 0.15rem 0.3rem;
  border-radius: 0.25rem;
  border-width: 0.0625rem 0.0625rem 0.1875rem;
  border-style: solid;
  border-color: rgb(54, 57, 64);
  border-image: initial;
}
</style>
<div class="backdrop" part="backdrop">
  <div class="window" part="window">
    <pre class="message" part="message"><span class="plugin" part="plugin"></span><span class="message-body" part="message-body"></span></pre>
    <pre class="file" part="file"></pre>
    <pre class="frame" part="frame"></pre>
    <pre class="stack" part="stack"></pre>
    <div class="tip" part="tip">
      Click outside, press <kbd>Esc</kbd> key, or fix the code to dismiss.<br>
      You can also disable this overlay by setting
      <code part="config-option-name">server.hmr.overlay</code> to <code part="config-option-value">false</code> in <code part="config-file-name">vite.config.js.</code>
    </div>
  </div>
</div>
`

const fileRegex = /(?:[a-zA-Z]:\\|\/).*?:\d+:\d+/g

const codeframeRegex = /^(?:>?\s+\d+\s+\|.*|\s+\|\s*\^.*)\r?\n/gm

/**
 * Substitute for `globalThis` object that will be defined in NodeJS and the browser.
 */
const currentThis: typeof globalThis =
  typeof globalThis === 'undefined' ? ({ HTMLElement: class {} } as typeof globalThis) : globalThis

export class ErrorOverlay extends currentThis.HTMLElement {
  root: ShadowRoot

  closeOnEsc: (e: KeyboardEvent) => void

  /**
   * @param err The error information from the {@link ErrorPayload}
   * @param [linkFiles=true] Whether to link the file paths in the error message to the source code.
   */
  constructor(err: ErrorInfo, linkFiles = true) {
    super()
    this.root = this.attachShadow({ mode: 'open' })
    this.root.innerHTML = template

    codeframeRegex.lastIndex = 0

    const hasFrame = err.frame && codeframeRegex.test(err.frame)

    /**
     * Exclude the code frame from the error message.
     */
    const message = hasFrame ? err.message.replace(codeframeRegex, '') : err.message

    /**
     * If the error originated from a plugin, add a plugin box div?
     */
    if (err.plugin) {
      this.text('.plugin', err.plugin)
    }

    this.text('.message-body', message.trim())

    const [file] = (err.loc?.file ?? err.id ?? 'unknown-file').split('?')

    /**
     * Shows, and possibly links the file path where the error occurred.
     */
    if (err.loc) {
      this.text('.file', `${file}:${err.loc.line}:${err.loc.column}`, linkFiles)
    } else if (err.id) {
      this.text('.file', file)
    }

    /**
     * Add stack trace?
     */
    if (hasFrame) {
      this.text('.frame', err.frame?.trim())
    }

    this.text('.stack', err.stack, linkFiles)

    /**
     * Don't propagate clicks outside ths window?
     *
     * This is a shadow DOM, so this prevents the clicks from propagating to the original DOM?
     */
    this.root.querySelector('.window')?.addEventListener('click', (e) => e.stopPropagation())

    this.addEventListener('click', () => this.close())

    this.closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        this.close()
      }
    }

    document.addEventListener('keydown', this.closeOnEsc.bind(this))
  }

  text(selector: string, text: string = '', linkFiles = false): void {
    const element = this.root.querySelector(selector)

    if (!element) {
      return
    }

    if (!linkFiles) {
      element.textContent = text
    } else {
      let currentIndex = 0
      let match: RegExpExecArray | null

      fileRegex.lastIndex = 0

      while ((match = fileRegex.exec(text))) {
        if (match.index == null || match[0] == null) {
          continue
        }

        const file = match[0]

        const fragment = text.slice(currentIndex, match.index)
        element.append(document.createTextNode(fragment))

        const link = document.createElement('a')

        link.textContent = file
        link.className = 'file-link'
        link.addEventListener('click', () => {
          /**
           * TODO: create an RPC-like wrapper around this for consistency.
           */
          fetch(`${base}__open-in-editor?file=` + encodeURIComponent(file))
        })

        element.appendChild(link)

        currentIndex += fragment.length + file.length
      }
    }
  }

  close(): void {
    this.parentNode?.removeChild(this)
    document.removeEventListener('keydown', this.closeOnEsc)
  }
}

export const overlayId = 'vite-error-overlay'

if (currentThis?.customElements && !currentThis.customElements.get(overlayId)) {
  customElements.define(overlayId, ErrorOverlay)
}
