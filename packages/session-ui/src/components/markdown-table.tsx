import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { render } from "solid-js/web"

const LABELS = {
  copy: "Copy table",
  csv: "Download CSV",
  expand: "Expand",
}

const disposers = new WeakMap<HTMLElement, () => void>()

function rows(table: HTMLTableElement) {
  return Array.from(table.rows).map((row) => Array.from(row.cells).map((cell) => (cell.textContent ?? "").trim()))
}

function tsv(table: HTMLTableElement) {
  return rows(table)
    .map((row) => row.join("\t"))
    .join("\n")
}

function csv(table: HTMLTableElement) {
  return rows(table)
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\n")
}

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function expand(table: HTMLTableElement) {
  const overlay = document.createElement("div")
  overlay.setAttribute("data-slot", "markdown-table-zoom")

  const panel = document.createElement("div")
  panel.setAttribute("data-slot", "markdown-table-zoom-panel")
  panel.appendChild(table.cloneNode(true))
  overlay.appendChild(panel)

  const close = () => {
    document.removeEventListener("keydown", onKey)
    overlay.remove()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close()
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close()
  })
  document.addEventListener("keydown", onKey)
  document.body.appendChild(overlay)
}

function TableTools(props: { table: HTMLTableElement }) {
  const action = (label: string, icon: string, onClick: () => void) => (
    <Tooltip placement="top" value={label}>
      <IconButton
        type="button"
        size="normal"
        variant="ghost-muted"
        aria-label={label}
        icon={<Icon name={icon} />}
        onClick={onClick}
      />
    </Tooltip>
  )

  return (
    <div data-slot="markdown-table-tools">
      {action(LABELS.copy, "outline-copy", () => void navigator.clipboard.writeText(tsv(props.table)))}
      {action(LABELS.csv, "outline-square-arrow", () =>
        save("table.csv", "\ufeff" + csv(props.table), "text/csv;charset=utf-8"),
      )}
      {action(LABELS.expand, "outline-arrow-to-corner-top-right", () => expand(props.table))}
    </div>
  )
}

/**
 * Wraps every rendered table in a card with a header that carries its actions. The markdown
 * pipeline injects HTML, so this runs after the fact and is idempotent — the observer fires on
 * every streamed block, and already-enhanced tables are skipped.
 */
export function enhanceTables(root: HTMLElement) {
  for (const element of Array.from(root.querySelectorAll("table"))) {
    if (!(element instanceof HTMLTableElement)) continue
    if (element.closest('[data-component="markdown-table"]')) continue

    const block = document.createElement("div")
    block.setAttribute("data-component", "markdown-table")

    const head = document.createElement("div")
    head.setAttribute("data-slot", "markdown-table-head")

    const label = document.createElement("span")
    label.setAttribute("data-slot", "markdown-table-label")
    const columns = element.rows[0]?.cells.length ?? 0
    label.textContent = `${element.rows.length} 行 × ${columns} 列`

    const tools = document.createElement("div")
    disposers.set(block, render(() => <TableTools table={element} />, tools))

    head.append(label, tools)

    const scroll = document.createElement("div")
    scroll.setAttribute("data-slot", "markdown-table-scroll")

    element.replaceWith(block)
    scroll.appendChild(element)
    block.append(head, scroll)
  }
}

export function disposeTables(root: HTMLElement) {
  for (const block of Array.from(root.querySelectorAll('[data-component="markdown-table"]'))) {
    if (!(block instanceof HTMLElement)) continue
    disposers.get(block)?.()
    disposers.delete(block)
  }

  document.querySelectorAll('[data-slot="markdown-table-zoom"]').forEach((overlay) => overlay.remove())
}
