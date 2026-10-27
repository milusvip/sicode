/**
 * SiCode: ask an OpenAI-compatible endpoint what it serves, so the custom-provider form can offer
 * its model list instead of making the user type ids from memory. Runs wherever the caller lives
 * (the server answers the UI; the plugin host exposes it to plugins) — never in a renderer, where
 * CORS would hide the answer for most providers.
 */
import { Effect } from "effect"

const PROBE_TIMEOUT_MS = 15_000

export type ProbeModel = { id: string; name?: string }

export type ProbeInput = {
  baseURL: string
  apiKey?: string
  headers?: Readonly<Record<string, string>>
}

/**
 * An OpenAI-compatible listing is `{ data: [{ id }] }`; Ollama answers `{ models: [{ name }] }` and
 * some gateways return a bare array. Accept all three so a working endpoint does not have to be
 * re-formatted by hand.
 */
function modelEntries(json: unknown): ProbeModel[] {
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as { data?: unknown })?.data)
      ? (json as { data: unknown[] }).data
      : Array.isArray((json as { models?: unknown })?.models)
        ? (json as { models: unknown[] }).models
        : []

  const seen = new Set<string>()

  return list.flatMap((item) => {
    if (typeof item === "string" && item) return [{ id: item }]
    if (!item || typeof item !== "object") return []
    const entry = item as { id?: unknown; model?: unknown; name?: unknown }
    const id =
      typeof entry.id === "string" && entry.id
        ? entry.id
        : typeof entry.model === "string" && entry.model
          ? entry.model
          : typeof entry.name === "string" && entry.name
            ? entry.name
            : undefined
    if (!id || seen.has(id)) return []
    seen.add(id)
    const name = typeof entry.name === "string" && entry.name !== id ? entry.name : undefined
    return [name ? { id, name } : { id }]
  })
}

async function reason(response: Response) {
  try {
    const text = (await response.text()).slice(0, 400)
    try {
      const json = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown }
      const message = json.error?.message ?? json.message
      if (typeof message === "string" && message) return message
    } catch {
      // Not JSON — the body itself is the explanation.
    }
    return text || response.statusText
  } catch {
    return response.statusText
  }
}

async function requestModels(input: ProbeInput): Promise<ProbeModel[]> {
  const base = input.baseURL.trim().replace(/\/+$/, "")

  if (!/^https?:\/\//i.test(base)) throw new Error("Base URL must start with http:// or https://")

  const headers: Record<string, string> = { Accept: "application/json", ...input.headers }
  const hasAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
  if (input.apiKey && !hasAuthorization) headers.Authorization = `Bearer ${input.apiKey}`

  const urls = base.endsWith("/v1") ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`]
  let failure: Error | undefined

  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (!response.ok) {
        failure = new Error(`${response.status} ${response.statusText} — ${await reason(response)}`)
        continue
      }
      return modelEntries(await response.json())
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw failure ?? new Error("Unable to reach the provider")
}

export const probeModels = (input: ProbeInput) =>
  Effect.tryPromise({
    try: () => requestModels(input),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
