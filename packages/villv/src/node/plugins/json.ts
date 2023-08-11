/**
 * JSON plugin settings.
 */
export interface JsonOptions {
  /**
   * Generate a named export for every property of the JSON object.
   *
   * @default true
   */
  namedExports?: boolean

  /**
   * Generate performance output as `JSON.parse("stringified json")`.
   * Enabling this will disable {@link namedExports}.
   *
   * @default false
   */
  stringify?: boolean
}
