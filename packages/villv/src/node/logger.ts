import readline from 'node:readline'
import colors from 'picocolors'
import type { RollupError } from 'rollup'

const DEFAULT_PREFIX = '[vite]'

/*---------------------------------------------------------------------------------*/
/* #region Shared logging state. */
/*---------------------------------------------------------------------------------*/

let lastType: LogType | undefined

let lastMsg: string | undefined

let sameCount = 0

/*----------------------------------------------------------------------------------*/
/* #endregion */
/*----------------------------------------------------------------------------------*/

/**
 * TODO: move this to src/node/server/index.ts
 */
export interface ResolvedServerUrls {
  local: string[]
  network: string[]
}

/**
 */
export type LogType = 'error' | 'warn' | 'info'

/**
 */
export type LogLevel = LogType | 'silent'

/**
 * Options when invoking a logger method.
 */
export interface LogOptions {
  /**
   * Whether to clear the terminal.
   */
  clear?: boolean

  /**
   * Whether to include the current timestamp.
   */
  timestamp?: boolean
}

/**
 * Options when invoking the logger's error method.
 */
export interface LogErrorOptions extends LogOptions {
  error?: Error | RollupError | null
}

/**
 * All loggers must implement this interface.
 *
 * TODO: I think this can be represented as a class?
 */
export interface Logger {
  info(msg: string, options?: LogOptions): void
  warn(msg: string, options?: LogOptions): void
  warnOnce(msg: string, options?: LogOptions): void
  error(msg: string, options?: LogErrorOptions): void
  clearScreen(logType: LogType): void
  hasErrorLogged(error: Error | RollupError): boolean
  hasWarned: boolean
}

/**
 */
export const LogLevels: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
}

/**
 * Options for initializing a new logger.
 */
interface LoggerOptions {
  /**
   * Add a prefix to all log messages.
   */
  prefix?: string

  /**
   * Whether to clear the terminal when logging.
   */
  allowClearScreen?: boolean

  /**
   * Use a custom logger instead of creating a new one.
   *
   * TODO: why does this exist? Just don't call this function?
   */
  customLogger?: Logger
}

/**
 * Create a new logger.
 *
 * @param level The maximum log level this logger will output.
 * @param options Options for the logger.
 */
export function createLogger(level: LogLevel = 'info', options: LoggerOptions = {}): Logger {
  if (options.customLogger) {
    return options.customLogger
  }

  const { prefix = DEFAULT_PREFIX, allowClearScreen = true } = options

  const threshold = LogLevels[level]

  const canClearScreen = allowClearScreen && process.stdout.isTTY && !process.env['CI']

  const loggedErrors = new WeakSet<Error | RollupError>()

  const warnedMessages = new Set<string>()

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })

  function output(type: LogType, msg: string, options: LogErrorOptions = {}) {
    if (LogLevels[type] > threshold) {
      return
    }

    const method = type === 'info' ? 'log' : type

    if (options.error) {
      loggedErrors.add(options.error)
    }

    if (!canClearScreen) {
      console[method](
        format(type, msg, prefix, options.timestamp && timeFormatter.format(new Date())),
      )
      return
    }

    if (type === lastType && msg === lastMsg) {
      if (canClearScreen) {
        clearScreen()
      }

      sameCount++

      console[method](
        format(type, msg, prefix, options.timestamp && timeFormatter.format(new Date())),
        colors.yellow(`(x${sameCount + 1})`),
      )

      return
    }

    sameCount = 0
    lastMsg = msg
    lastType = type

    if (canClearScreen && options.clear) {
      clearScreen()
    }
  }

  const logger: Logger = {
    hasWarned: false,
    info(msg, options) {
      output('info', msg, options)
    },
    warn(msg, options) {
      this.hasWarned = true
      output('warn', msg, options)
    },
    warnOnce(msg, options) {
      if (warnedMessages.has(msg)) {
        return
      }
      this.hasWarned = true
      output('warn', msg, options)
      warnedMessages.add(msg)
    },
    error(msg, options) {
      this.hasWarned = true
      output('error', msg, options)
    },
    clearScreen(logType) {
      if (threshold >= LogLevels[logType] && canClearScreen) {
        clearScreen()
      }
    },
    hasErrorLogged(error) {
      return loggedErrors.has(error)
    },
  }

  return logger
}

/**
 * Prints the server URLs to the console.
 *
 * @param urls The resolved server URLs.
 * @param host The host to use.
 * @param info The logger's `info` method.
 */
export function printServerUrls(
  urls: ResolvedServerUrls,
  host: string | boolean | undefined,
  info: Logger['info'],
): void {
  urls.local.forEach((url) => {
    info(`  ${colors.green('➜')}  ${colors.bold('Local')}:   ${colorUrl(url)}`)
  })

  urls.network.forEach((url) => {
    info(`  ${colors.green('➜')}  ${colors.bold('Network')}: ${colorUrl(url)}`)
  })

  // If not hosting, then it's only available privately, i.e. via localhost.
  // Add a message informing the user how to expose it to the network.
  if (!urls.network.length && host == null) {
    info(
      colors.dim(`  ${colors.green('➜')}  ${colors.bold('Network')}: use `) +
        colors.bold('--host') +
        colors.dim(' to expose'),
    )
  }
}

/**
 * Clears the screen by printing a bunch of newlines and then relocating the cursor to the top-left.
 *
 * __maintains the previous console history__
 */
function clearScreen(): void {
  const rows = process.stdout.rows - 2
  const blankRows = rows > 0 ? `\n`.repeat(rows) : ''

  console.log(blankRows)

  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

/**
 * Formats a string that's printed to the terminal.
 *
 * @param type The type of log.
 * @param msg The message to print.
 * @param prefix The prefix to add to the message.
 * @param timestamp The timestamp to add to the message, or false to disable.
 */
function format(type: LogType, msg: string, prefix: string, timestamp?: string | false): string {
  return timestamp ? `${colors.dim(timestamp)} ${formatPrefix(type, prefix)} ${msg}` : msg
}

/**
 * Colors a log prefix based on its type.
 *
 * @param type The type of log.
 * @param prefix The prefix to color.
 */
function formatPrefix(type: LogType, prefix: string): string {
  switch (type) {
    case 'info':
      return colors.cyan(colors.bold(prefix))

    case 'warn':
      return colors.yellow(colors.bold(prefix))

    case 'error':
      return colors.red(colors.bold(prefix))

    default:
      return prefix
  }
}

/**
 * Colors the printed server URL.
 *
 * @param url The URL to color.
 */
function colorUrl(url: string): string {
  return colors.cyan(url.replace(/:(\d+)\//, (_, port) => `:${colors.bold(port)}/`))
}
