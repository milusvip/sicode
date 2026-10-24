import type { JSX } from "solid-js"
import type { ContextMenuActionID } from "./model"

// Local glyphs: the shared icon catalog has no clipboard set, and a context menu needs the whole
// group to read as one family. 24-unit geometry drawn at 16px to match the catalog's optical size.
function glyph(children: JSX.Element) {
  return (
    <svg
      data-slot="sicode-context-menu-glyph"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const GLYPHS: Record<ContextMenuActionID, () => JSX.Element> = {
  "edit.undo": () =>
    glyph(
      <>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </>,
    ),
  "edit.redo": () =>
    glyph(
      <>
        <path d="m15 14 5-5-5-5" />
        <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
      </>,
    ),
  "edit.cut": () =>
    glyph(
      <>
        <circle cx="6" cy="6" r="2.6" />
        <circle cx="6" cy="18" r="2.6" />
        <path d="M20 4 8.6 15.4" />
        <path d="M14.6 14.6 20 20" />
        <path d="M8.6 8.6 12 12" />
      </>,
    ),
  "edit.copy": () =>
    glyph(
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
      </>,
    ),
  "edit.paste": () =>
    glyph(
      <>
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      </>,
    ),
  "edit.delete": () =>
    glyph(
      <>
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      </>,
    ),
  "edit.selectAll": () =>
    glyph(
      <>
        <path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2" />
        <path d="M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1" />
      </>,
    ),
  "link.open": () =>
    glyph(
      <>
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>,
    ),
  "link.copy": () =>
    glyph(
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>,
    ),
  "view.inspectElement": () =>
    glyph(
      <>
        <path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
        <path d="m13 13 8 2.6-3.4 1.4L16.2 21 13 13Z" />
      </>,
    ),
  "view.toggleDevTools": () =>
    glyph(
      <>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
      </>,
    ),
  "view.reload": () =>
    glyph(
      <>
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </>,
    ),
}

export function ContextMenuGlyph(props: { action: ContextMenuActionID }) {
  return GLYPHS[props.action]()
}
