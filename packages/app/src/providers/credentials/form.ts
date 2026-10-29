const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

/** Persisted package for OpenAI-compatible custom providers (V2 `providers` config). */
export const OPENAI_COMPATIBLE_PACKAGE = "aisdk:@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  context?: string
  output?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  /** Capabilities: the schema's defaults are tools on and image input on, reasoning off. */
  tools: boolean
  image: boolean
  reasoning: boolean
  /** Raw text so an empty field means "provider default" and never writes a limit. */
  context: string
  output: string
  /** Per-row disclosure for the advanced block; UI state, never persisted. */
  advanced: boolean
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

/** A model entry as this form writes it: only the fields the user actually changed from defaults.
 *  Read-side fields the form does not edit (output modalities, temperature, input limit) stay
 *  optional so an existing config round-trips unchanged. */
export type ModelConfigEntry = {
  name: string
  capabilities?: {
    tools?: boolean
    input?: string[]
    output?: string[]
    temperature?: boolean
    reasoning?: { supported: boolean }
  }
  limit?: { context?: number; input?: number; output?: number }
}

export type CustomProviderConfig = {
  name: string
  package: string
  env?: string[]
  settings: { baseURL: string }
  headers?: Record<string, string>
  models: Record<string, ModelConfigEntry>
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /** When editing, the current provider id is allowed to "exist". */
  editingProviderID?: string
}

export function isCustomProviderPackage(value?: string) {
  if (!value) return false

  return value.includes("openai-compatible") && !value.includes("responses")
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined

  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const self = input.editingProviderID === providerID

  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled && !self
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()

  /** Empty means "use the provider default"; anything else must be a positive whole number. */
  const limitValue = (raw: string) => {
    const value = raw.trim()

    if (!value) return {}
    if (!/^\d+$/u.test(value) || Number(value) <= 0) return { error: input.t("provider.custom.error.number") }

    return { value: Number(value) }
  }

  const models = input.form.models.map((m) => {
    const id = m.id.trim()

    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)

            return undefined
          })()

    // The display name is optional: an endpoint's model ids are usually legible enough, and a
    // fetched list should not force a second field per row. Empty falls back to the id.
    return { id: idError, context: limitValue(m.context).error, output: limitValue(m.output).error }
  })

  const modelsValid = models.every((m) => !m.id && !m.context && !m.output)

  const modelEntry = (m: ModelRow): ModelConfigEntry => {
    // Only what differs from the schema defaults is written: a config that spells out `tools: true`
    // for every model is noise, and a stale copy if the default ever changes.
    const capabilities = {
      ...(m.tools ? {} : { tools: false }),
      ...(m.image ? {} : { input: ["text"] }),
      ...(m.reasoning ? { reasoning: { supported: true } } : {}),
    }
    const context = limitValue(m.context).value
    const output = limitValue(m.output).value

    return {
      name: m.name.trim() || m.id.trim(),
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
      ...(context || output ? { limit: { ...(context ? { context } : {}), ...(output ? { output } : {}) } } : {}),
    }
  }

  const modelConfig = Object.fromEntries(input.form.models.map((m) => [m.id.trim(), modelEntry(m)]))

  const seenHeaders = new Set<string>()

  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}

    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())

            return undefined
          })()

    const valueError = !value ? input.t("provider.custom.error.required") : undefined

    return { key: keyError, value: valueError }
  })

  const headersValid = headers.every((h) => !h.key && !h.value)

  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid

  if (!ok) return { err, models, headers }

  const config: CustomProviderConfig = {
    name,
    package: OPENAI_COMPATIBLE_PACKAGE,
    ...(env ? { env: [env] } : {}),
    settings: { baseURL },
    ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
    models: modelConfig,
  }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config,
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (): ModelRow => ({
  row: nextRow(),
  id: "",
  name: "",
  tools: true,
  image: true,
  reasoning: false,
  context: "",
  output: "",
  advanced: false,
  err: {},
})

export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })

/** A provider id derived from a display name, offered until the user edits the id themselves. */
export function providerIDFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
}

export function formFromConfig(input: {
  providerID: string
  config: {
    name?: string
    env?: readonly string[]
    settings?: { baseURL?: string }
    headers?: Record<string, string>
    models?: Record<string, { name?: string } & Omit<ModelConfigEntry, "name">>
  }
}): FormState {
  const models = Object.entries(input.config.models ?? {}).map(([id, model]) => ({
    row: nextRow(),
    id,
    name: model.name ?? id,
    tools: model.capabilities?.tools !== false,
    image: !model.capabilities?.input || model.capabilities.input.includes("image"),
    reasoning: model.capabilities?.reasoning?.supported === true,
    context: model.limit?.context ? String(model.limit.context) : "",
    output: model.limit?.output ? String(model.limit.output) : "",
    // Anything beyond the defaults opens the block, so an existing setup is visible at a glance.
    advanced:
      model.capabilities?.tools === false ||
      (!!model.capabilities?.input && !model.capabilities.input.includes("image")) ||
      model.capabilities?.reasoning?.supported === true ||
      !!model.limit?.context ||
      !!model.limit?.output,
    err: {},
  }))
  const headers = Object.entries(input.config.headers ?? {}).map(([key, value]) => ({
    row: nextRow(),
    key,
    value,
    err: {},
  }))
  const env = input.config.env?.[0]

  return {
    providerID: input.providerID,
    name: input.config.name ?? input.providerID,
    baseURL: input.config.settings?.baseURL ?? "",
    apiKey: env ? `{env:${env}}` : "",
    models: models.length > 0 ? models : [modelRow()],
    headers: headers.length > 0 ? headers : [headerRow()],
    err: {},
  }
}
