import { popularProviders } from "@/providers/catalog/order"

/** Rank: remembered order first, then popular catalog, then name. */
export function compareProviderOrder(
  a: { id: string; name: string },
  b: { id: string; name: string },
  order: readonly string[],
) {
  const rank = new Map(order.map((id, index) => [id, index] as const))
  const aOrder = rank.get(a.id)
  const bOrder = rank.get(b.id)

  if (aOrder !== undefined || bOrder !== undefined) {
    if (aOrder === undefined) return 1
    if (bOrder === undefined) return -1
    if (aOrder !== bOrder) return aOrder - bOrder
  }

  const aPopular = popularProviders.indexOf(a.id)
  const bPopular = popularProviders.indexOf(b.id)
  const aKnown = aPopular >= 0
  const bKnown = bPopular >= 0

  if (aKnown && !bKnown) return -1
  if (!aKnown && bKnown) return 1
  if (aKnown && bKnown && aPopular !== bPopular) return aPopular - bPopular

  return a.name.localeCompare(b.name)
}

export function reorderProviderOrder(order: readonly string[], ids: readonly string[], from: number, to: number) {
  const next = ids.slice()
  const [moved] = next.splice(from, 1)

  if (!moved) return order.slice()
  next.splice(to, 0, moved)

  const seen = new Set(next)
  return [...next, ...order.filter((id) => !seen.has(id))]
}
