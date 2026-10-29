export type ContextMenuPlatform = "macos" | "windows" | "linux"

export type ContextMenuActionID =
  | "link.open"
  | "link.copy"
  | "image.copy"
  | "image.copyAddress"
  | "message.copy"
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
  | "contextMenu.copyImage"
  | "contextMenu.copyImageAddress"
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
  /** SiCode: src of the image under the pointer, so the menu can copy it and its address. */
  image: string | undefined
  /** SiCode: full text of the message bubble under the pointer, for copy without a selection. */
  message: string | undefined
  /** Whether developer items are offered. */
  dev: boolean
}

export type ContextMenuTargetInput = {
  editable: boolean
  selection: string
  link?: string
  image?: string
  message?: string
  dev: boolean
}

export function contextMenuTarget(input: ContextMenuTargetInput): ContextMenuTarget {
  return {
    editable: input.editable,
    selection: input.selection,
    link: input.link,
    image: input.image,
    message: input.message,
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

  // SiCode: image items follow link items, the browser's order for an image inside a link.
  if (target.image) {
    sections.push([
      { type: "item", action: "image.copy", labelKey: "contextMenu.copyImage" },
      { type: "item", action: "image.copyAddress", labelKey: "contextMenu.copyImageAddress" },
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
    // SiCode: on a message bubble with nothing selected, 复制 copies the whole bubble; with a
    // selection the existing item already does the right thing, so the whole-bubble copy backs off.
    const messageCopy = !selected && target.message
      ? [{ type: "item" as const, action: "message.copy" as const, labelKey: "desktop.menu.copy" as const }]
      : []

    sections.push([
      ...messageCopy,
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
