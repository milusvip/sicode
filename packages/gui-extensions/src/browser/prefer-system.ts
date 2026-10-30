/**
 * Per-conversation Agent browser sticky (cross-project-focus shaped):
 * - map true → system; false → in-app pane; absent → inherit default
 * - default true while the extension may be connected (absent = follow system)
 */
export function effectivePreferSystem(input: {
  readonly session?: string
  readonly globalDefault: boolean
  readonly map: Readonly<Record<string, boolean>>
}): boolean {
  if (!input.session) return input.globalDefault
  if (input.map[input.session] === true) return true
  if (input.map[input.session] === false) return false
  return input.globalDefault
}
