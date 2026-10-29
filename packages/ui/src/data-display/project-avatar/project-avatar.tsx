import { type ComponentProps, splitProps, Show } from "solid-js"
import "./project-avatar.css"

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined

function first(value: string) {
  if (!value) return ""

  if (!segmenter) return Array.from(value)[0] ?? ""

  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? Array.from(value)[0] ?? ""
}

export const PROJECT_AVATAR_VARIANTS = [
  "orange",
  "yellow",
  "cyan",
  "green",
  "red",
  "pink",
  "blue",
  "purple",
  // SiCode: four extra hues filling the gaps the original nine left on the colour wheel.
  "olive",
  "teal",
  "sky",
  "fuchsia",
  "gray",
] as const

export type ProjectAvatarVariant = (typeof PROJECT_AVATAR_VARIANTS)[number]

// "outline" is a neutral, muted style (e.g. recently closed projects) and is not part of the color rotation.
export type ProjectAvatarStyle = ProjectAvatarVariant | "outline"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === OPENCODE_PROJECT_ID) return "https://opencode.ai/favicon.svg"

  if (icon?.override) return icon.override

  if (icon?.color) return undefined

  return icon?.url
}

export function getProjectAvatarVariant(key?: string): ProjectAvatarVariant {
  if (key === "mint") return "cyan"

  if (key === "lime") return "green"

  if (
    key === "orange" ||
    key === "yellow" ||
    key === "cyan" ||
    key === "green" ||
    key === "red" ||
    key === "pink" ||
    key === "blue" ||
    key === "purple" ||
    key === "olive" ||
    key === "teal" ||
    key === "sky" ||
    key === "fuchsia" ||
    key === "gray"
  )
    return key

  return "gray"
}

// Projects are created by the server on first resolve, and nothing assigns them a colour, so an
// untouched project has no `icon.color` at all. Falling straight through to "gray" made every
// project in the sidebar look colourless, so an unset colour is derived from the project instead:
// stable across reloads and machines, and still distinguishable from a colour the user actually
// picked (that one is stored, and wins).
const DERIVED_VARIANTS = PROJECT_AVATAR_VARIANTS.filter((variant) => variant !== "gray")

/** FNV-1a over UTF-16 code points; only the low bits are used, so a stable cheap spread is enough. */
function hash(value: string) {
  return (
    Array.from(value).reduce((state, char) => Math.imul(state ^ (char.codePointAt(0) ?? 0), 16777619), 2166136261) >>>
    0
  )
}

/**
 * The directory is the primary key on purpose: it is present the moment a project is added, while
 * `id` only arrives once the bootstrap metadata table refreshes. Keying on `id` alone left every
 * freshly added project grey — the exact case this exists for. `id` stays as the fallback for a
 * caller that has no directory, so a project keeps one colour for its lifetime.
 */
export function resolveProjectAvatarVariant(project?: {
  id?: string
  worktree?: string
  icon?: { color?: string }
}): ProjectAvatarVariant {
  if (project?.icon?.color) return getProjectAvatarVariant(project.icon.color)

  const key = project?.worktree ?? project?.id

  if (!key) return "gray"

  return DERIVED_VARIANTS[hash(key) % DERIVED_VARIANTS.length] ?? "gray"
}

export const displayName = (project: { name?: string; worktree: string }) => {
  const trimmed = project.worktree.replace(/[/\\]+$/, "")
  const filename = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1)

  return project.name || filename || project.worktree
}

export interface ProjectAvatarProps extends ComponentProps<"div"> {
  fallback: string
  src?: string
  variant?: ProjectAvatarStyle
  unread?: boolean
}

export function ProjectAvatar(props: ProjectAvatarProps) {
  const [split, rest] = splitProps(props, ["fallback", "src", "variant", "unread", "class", "classList", "style"])

  return (
    <div
      {...rest}
      data-component="project-avatar-v2"
      data-unread={split.unread ? "" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
      style={typeof split.style === "object" ? split.style : undefined}
    >
      <div
        data-slot="project-avatar-surface"
        data-variant={split.variant ?? "gray"}
        data-has-image={split.src ? "" : undefined}
      >
        <Show when={split.src} fallback={first(split.fallback)}>
          {(value) => <img src={value()} draggable={false} data-slot="project-avatar-image" />}
        </Show>
      </div>
      <Show when={split.unread}>
        <span data-slot="project-avatar-unread-dot" aria-hidden="true" />
      </Show>
    </div>
  )
}
