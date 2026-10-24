import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"

export type TableLabels = {
  size: (rows: number, columns: number) => string
  copy: string
  copied: string
  download: string
  expand: string
  close: string
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

function action(label: string, icon: string, onClick: () => void) {
  return (
    <Tooltip placement="top" value={label}>
      <IconButton
        type="button"
        size="small"
        variant="ghost-muted"
        aria-label={label}
        icon={<Icon name={icon} size="small" />}
        onClick={onClick}
      />
    </Tooltip>
  )
}

function CopyAction(props: { table: HTMLTableElement; copy: string; copied: string }) {
  const [copied, setCopied] = createSignal(false)
  let reset: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (reset) clearTimeout(reset)
  })

  const label = () => (copied() ? props.copied : props.copy)

  return (
    <Tooltip placement="top" value={label()}>
      <IconButton
        type="button"
        size="small"
        variant="ghost-muted"
        aria-label={label()}
        data-slot="markdown-table-copy"
        data-copied={copied() ? "true" : undefined}
        icon={
          <>
            <Icon name="outline-copy" size="small" data-copy-icon />
            <Icon name="check" size="small" data-check-icon />
          </>
        }
        onClick={() => {
          void navigator.clipboard.writeText(tsv(props.table)).then(() => {
            setCopied(true)
            if (reset) clearTimeout(reset)
            reset = setTimeout(() => setCopied(false), 1500)
          })
        }}
      />
    </Tooltip>
  )
}

function TableActions(props: { table: HTMLTableElement; labels: TableLabels; onExpand?: () => void; onClose?: () => void }) {
  return (
    <>
      <CopyAction table={props.table} copy={props.labels.copy} copied={props.labels.copied} />
      {action(props.labels.download, "outline-download", () =>
        save("table.csv", "\ufeff" + csv(props.table), "text/csv;charset=utf-8"),
      )}
      {props.onExpand ? action(props.labels.expand, "outline-maximize", props.onExpand) : undefined}
      {props.onClose ? action(props.labels.close, "close-small", props.onClose) : undefined}
    </>
  )
}

function expand(table: HTMLTableElement, labels: TableLabels) {
  const overlay = document.createElement("div")
  overlay.setAttribute("data-slot", "markdown-table-zoom")

  const panel = document.createElement("div")
  panel.setAttribute("data-slot", "markdown-table-zoom-panel")

  const head = document.createElement("div")
  head.setAttribute("data-slot", "markdown-table-zoom-head")

  const title = document.createElement("span")
  title.setAttribute("data-slot", "markdown-table-zoom-label")
  const columns = table.rows[0]?.cells.length ?? 0
  title.textContent = labels.size(table.rows.length, columns)

  const tools = document.createElement("div")
  tools.setAttribute("data-slot", "markdown-table-zoom-tools")

  const scroll = document.createElement("div")
  scroll.setAttribute("data-slot", "markdown-table-zoom-scroll")
  scroll.appendChild(table.cloneNode(true))

  let dispose = () => {}
  const close = () => {
    document.removeEventListener("keydown", onKey)
    dispose()
    overlay.remove()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close()
  }

  dispose = render(() => <TableActions table={table} labels={labels} onClose={close} />, tools)

  head.append(title, tools)
  panel.append(head, scroll)
  overlay.appendChild(panel)

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close()
  })
  document.addEventListener("keydown", onKey)
  document.body.appendChild(overlay)
}

function TableTools(props: { table: HTMLTableElement; labels: TableLabels }) {
  return (
    <div data-slot="markdown-table-tools">
      <TableActions table={props.table} labels={props.labels} onExpand={() => expand(props.table, props.labels)} />
    </div>
  )
}

/**
 * Wraps every rendered table in a card with a header that carries its actions. The markdown
 * pipeline injects HTML, so this runs after the fact and is idempotent — the observer fires on
 * every streamed block, and already-enhanced tables are skipped.
 */
export function enhanceTables(root: HTMLElement, labels: TableLabels) {
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
    label.textContent = labels.size(element.rows.length, columns)

    const tools = document.createElement("div")
    disposers.set(block, render(() => <TableTools table={element} labels={labels} />, tools))

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
