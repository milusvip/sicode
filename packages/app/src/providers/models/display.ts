type ProviderLike = {
  id: string
  name: string
  options?: Record<string, unknown>
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim())
}

function hostLabel(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    const parts = host.split(".").filter(Boolean)

    if (parts.length >= 2) return parts[parts.length - 2] ?? host

    return host || url
  } catch {
    return url
  }
}

/** Prefer a human name; when the title is a raw URL, collapse it to the host slug. */
export function providerDisplay(provider: ProviderLike) {
  const baseURL = typeof provider.options?.baseURL === "string" ? provider.options.baseURL : undefined
  const urlLike = looksLikeUrl(provider.name)
  const title = urlLike ? hostLabel(provider.name) : provider.name
  const subtitle =
    baseURL && baseURL !== title ? baseURL : urlLike && provider.name !== title ? provider.name : undefined

  return { title, subtitle }
}
