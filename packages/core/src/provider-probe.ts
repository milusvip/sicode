/**
 * SiCode: ask an OpenAI-compatible endpoint what it serves, so the custom-provider form can offer
 * its model list instead of making the user type ids from memory, and can verify that a configured
 * key and model actually answer. Runs wherever the caller lives (the server answers the UI; the
 * plugin host exposes it to plugins) — never in a renderer, where CORS would hide the answer.
 */
import { Effect } from "effect"

const PROBE_TIMEOUT_MS = 15_000

export type ProbeModel = { id: string; name?: string }

export type ProbeInput = {
  baseURL: string
  apiKey?: string
  headers?: Readonly<Record<string, string>>
}

export type ChatProbeInput = ProbeInput & { model: string }

const ENV_KEY = /^\{env:([^}]+)\}$/

/**
 * The form's `{env:NAME}` syntax names an environment variable instead of a literal key, the same
 * way a saved provider reads it. Resolving it here (the probe already runs server-side) is what
 * keeps a variable-based provider's buttons working at all: sending the literal `{env:NAME}` as a
 * bearer token fails every time.
 */
function resolveApiKey(apiKey: string | undefined) {
  if (!apiKey) return undefined
  const name = apiKey.match(ENV_KEY)?.[1]?.trim()

  if (!name) return apiKey
  const value = process.env[name]?.trim()

  if (!value) throw new Error(`Environment variable ${name} is not set on the server`)

  return value
}

function prepare(input: ProbeInput) {
  const base = input.baseURL.trim().replace(/\/+$/, "")

  if (!/^https?:\/\//i.test(base)) throw new Error("Base URL must start with http:// or https://")

  const headers: Record<string, string> = { Accept: "application/json", ...input.headers }
  const apiKey = resolveApiKey(input.apiKey)

  if (apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization"))
    headers.Authorization = `Bearer ${apiKey}`

  return { base, headers }
}

/**
 * OpenAI-compatible servers answer under `/v1`, so a bare host tries that first; a base URL
 * already ending in `/v1` only adds the suffix, and a host that serves the suffix at its root is
 * the second candidate.
 */
function candidates(base: string, suffix: string) {
  return base.endsWith("/v1") ? [`${base}/${suffix}`] : [`${base}/v1/${suffix}`, `${base}/${suffix}`]
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

// Every attempt is reported: the first candidate failing on a gateway that only serves the other
// one is normal, and keeping only the last error hid which address actually answered what.
const describe = (base: string, url: string) => (url.startsWith(base) ? url.slice(base.length) : url)

async function requestModels(input: ProbeInput): Promise<ProbeModel[]> {
  const { base, headers } = prepare(input)
  const attempts: string[] = []

  for (const url of candidates(base, "models")) {
    const path = describe(base, url)

    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (!response.ok) {
        attempts.push(`${path} → ${response.status} ${response.statusText} — ${await reason(response)}`)
        continue
      }
      return modelEntries(await response.json())
    } catch (error) {
      attempts.push(`${path} → ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(attempts.join("; ") || "Unable to reach the provider")
}

/** One one-token turn: the cheapest request that proves the key, the model, and the route all work. */
async function requestChat(input: ChatProbeInput): Promise<void> {
  const { base, headers } = prepare(input)
  const attempts: string[] = []

  for (const url of candidates(base, "chat/completions")) {
    const path = describe(base, url)

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (!response.ok) {
        attempts.push(`${path} → ${response.status} ${response.statusText} — ${await reason(response)}`)
        continue
      }
      return
    } catch (error) {
      attempts.push(`${path} → ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(attempts.join("; ") || "Unable to reach the provider")
}

const failure = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

export const probeModels = (input: ProbeInput) =>
  Effect.tryPromise({ try: () => requestModels(input), catch: failure })

export const probeChat = (input: ChatProbeInput) =>
  Effect.tryPromise({ try: () => requestChat(input), catch: failure })
