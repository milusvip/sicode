export type ContextMenuPlatform = "macos" | "windows" | "linux"

export type ContextMenuActionID =
  | "link.open"
  | "link.copy"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.inspectElement"
  | "view.toggleDevTools"
  | "view.reload"

export type ContextMenuLabelKey =
  | "contextMenu.openLink"
  | "contextMenu.copyLink"
  | "contextMenu.inspectElement"
  | "desktop.menu.undo"
  | "desktop.menu.redo"
  | "desktop.menu.cut"
  | "desktop.menu.copy"
  | "desktop.menu.paste"
  | "desktop.menu.delete"
  | "desktop.menu.selectAll"
  | "desktop.menu.toggleDeveloperTools"
  | "desktop.menu.reload"

export type ContextMenuItem = {
  type: "item"
  action: ContextMenuActionID
  labelKey: ContextMenuLabelKey
  shortcut?: string
  danger?: boolean
  disabled?: boolean
}

/** Sections render with a separator between them, never inside one. */
export type ContextMenuSection = ContextMenuItem[]

/** What the pointer landed on, reduced to the facts the menu layout depends on. */
export type ContextMenuTarget = {
  /** Focused editor, so cut/paste/undo can target it after the menu steals focus. */
  editable: boolean
  /** Non-empty selection text, already extracted from the editor or the document. */
  selection: string
  /** Resolved href when the pointer landed inside a link. */
  link: string | undefined
  /** Whether developer items are offered. */
  dev: boolean
}

export type ContextMenuTargetInput = {
  editable: boolean
  selection: string
  link?: string
  dev: boolean
}

export function contextMenuTarget(input: ContextMenuTargetInput): ContextMenuTarget {
  return {
    editable: input.editable,
    selection: input.selection,
    link: input.link,
    dev: input.dev,
  }
}

export function contextMenuSelected(target: ContextMenuTarget) {
  return target.selection.trim().length > 0
}

function shortcuts(platform: ContextMenuPlatform) {
  if (platform === "macos")
    return { undo: "⌘Z", redo: "⇧⌘Z", cut: "⌘X", copy: "⌘C", paste: "⌘V", selectAll: "⌘A" }

  return { undo: "Ctrl+Z", redo: "Ctrl+Y", cut: "Ctrl+X", copy: "Ctrl+C", paste: "Ctrl+V", selectAll: "Ctrl+A" }
}

/**
 * Builds the menu for one right-click. Ordering follows the platform convention: history first,
 * then the clipboard group, then selection, with developer tools last so they never sit next to
 * a destructive item.
 */
export function contextMenuSections(target: ContextMenuTarget, platform: ContextMenuPlatform): ContextMenuSection[] {
  const keys = shortcuts(platform)
  const selected = contextMenuSelected(target)
  const sections: ContextMenuSection[] = []

  if (target.link) {
    sections.push([
      { type: "item", action: "link.open", labelKey: "contextMenu.openLink" },
      { type: "item", action: "link.copy", labelKey: "contextMenu.copyLink" },
    ])
  }

  if (target.editable) {
    sections.push([
      { type: "item", action: "edit.undo", labelKey: "desktop.menu.undo", shortcut: keys.undo },
      { type: "item", action: "edit.redo", labelKey: "desktop.menu.redo", shortcut: keys.redo },
    ])
    sections.push([
      { type: "item", action: "edit.cut", labelKey: "desktop.menu.cut", shortcut: keys.cut, disabled: !selected },
      { type: "item", action: "edit.copy", labelKey: "desktop.menu.copy", shortcut: keys.copy, disabled: !selected },
      { type: "item", action: "edit.paste", labelKey: "desktop.menu.paste", shortcut: keys.paste },
      {
        type: "item",
        action: "edit.delete",
        labelKey: "desktop.menu.delete",
        danger: true,
        disabled: !selected,
      },
    ])
    sections.push([
      { type: "item", action: "edit.selectAll", labelKey: "desktop.menu.selectAll", shortcut: keys.selectAll },
    ])
  } else {
    sections.push([
      ...(selected
        ? [{ type: "item" as const, action: "edit.copy" as const, labelKey: "desktop.menu.copy" as const, shortcut: keys.copy }]
        : []),
      { type: "item", action: "edit.selectAll", labelKey: "desktop.menu.selectAll", shortcut: keys.selectAll },
    ])
  }

  if (target.dev) {
    sections.push([
      { type: "item", action: "view.inspectElement", labelKey: "contextMenu.inspectElement" },
      { type: "item", action: "view.toggleDevTools", labelKey: "desktop.menu.toggleDeveloperTools" },
      { type: "item", action: "view.reload", labelKey: "desktop.menu.reload" },
    ])
  }

  return sections
}
