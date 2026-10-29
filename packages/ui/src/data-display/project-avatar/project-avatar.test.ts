import { describe, expect, test } from "bun:test"
import { PROJECT_AVATAR_VARIANTS, resolveProjectAvatarVariant } from "./project-avatar"

describe("project avatar variant", () => {
  test("keeps a colour the user picked", () => {
    expect(resolveProjectAvatarVariant({ worktree: "/repo", icon: { color: "purple" } })).toBe("purple")
    // A stored colour that is no longer a variant still wins over the derived one, as the
    // neutral fallback, rather than being replaced by an invented colour.
    expect(resolveProjectAvatarVariant({ worktree: "/repo", icon: { color: "mint" } })).toBe("cyan")
  })

  test("derives a stable non-gray colour for a project that has none", () => {
    const variant = resolveProjectAvatarVariant({ worktree: "/home/luke/repo" })
    expect(variant).not.toBe("gray")
    expect(PROJECT_AVATAR_VARIANTS).toContain(variant)
    expect(resolveProjectAvatarVariant({ worktree: "/home/luke/repo" })).toBe(variant)
  })

  test("colours a project that has a directory but no id yet", () => {
    // A project added in this window has no metadata row until bootstrap refreshes, so `id` is
    // absent for a while. That is the case the derived colour exists for.
    expect(resolveProjectAvatarVariant({ worktree: "/home/luke/fresh" })).not.toBe("gray")
    // The directory wins over the id, so the colour does not change once the id arrives.
    expect(resolveProjectAvatarVariant({ id: "abc", worktree: "/home/luke/fresh" })).toBe(
      resolveProjectAvatarVariant({ worktree: "/home/luke/fresh" }),
    )
  })

  test("spreads distinct projects across more than one colour", () => {
    const derived = new Set(
      Array.from({ length: 40 }, (_, index) => resolveProjectAvatarVariant({ worktree: `/repo-${index}` })),
    )
    expect(derived.size).toBeGreaterThan(1)

    // Nothing to derive from: a project still resolving keeps the neutral mark.
    expect(resolveProjectAvatarVariant({})).toBe("gray")
    expect(resolveProjectAvatarVariant(undefined)).toBe("gray")
  })
})
