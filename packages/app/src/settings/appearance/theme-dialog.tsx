import { type Accessor, Component, createMemo, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { ThemeCard } from "@opencode/ui/theme-card"
import { useTheme } from "@opencode/ui/theme/context"
import { themePreviewPalette } from "@opencode/ui/theme/preview"
import type { DesktopTheme } from "@opencode/ui/theme"
import { useLanguage } from "@/runtime/i18n/language"
import "@/settings/settings.css"

export const DialogThemeSelect: Component = () => {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme()
  const [store, setStore] = createStore({ search: "", active: theme.themeId() })

  // A theme is only previewable once its JSON is loaded; `oc-2` is always present.
  const options = createMemo(() =>
    theme.ids().flatMap((id) => {
      const desktop = theme.themes()[id]

      return desktop ? [{ id, name: theme.name(id), desktop }] : []
    }),
  )

  const matches = (query: string) => {
    const list = options()
    const trimmed = query.trim().toLowerCase()

    return trimmed ? list.filter((option) => option.name.toLowerCase().includes(trimmed)) : list
  }

  const visible = createMemo(() => matches(store.search))

  let grid: HTMLDivElement | undefined

  const card = (id: string) => grid?.querySelector<HTMLElement>(`[data-theme-id="${CSS.escape(id)}"]`)

  const move = (delta: number, focus: boolean) => {
    const list = visible()

    if (list.length === 0) return
    const index = list.findIndex((option) => option.id === store.active)
    const start = index === -1 ? (delta > 0 ? -1 : 0) : index
    const next = list[(start + delta + list.length) % list.length]!
    setStore("active", next.id)
    queueMicrotask(() => {
      const element = card(next.id)

      if (!element) return
      if (focus) element.focus({ preventScroll: true })
      element.scrollIntoView({ block: "nearest" })
    })
  }

  const setSearch = (value: string) => setStore({ search: value, active: matches(value)[0]?.id ?? "" })

  const select = (id: string) => {
    theme.setTheme(id)
    dialog.close()
  }

  const selectActive = () => {
    const active = visible().find((option) => option.id === store.active)

    if (active) select(active.id)
  }

  onMount(() => {
    // The grid opens at the top, but the current theme is somewhere in the middle.
    requestAnimationFrame(() => card(store.active)?.scrollIntoView({ block: "center" }))
  })

  return (
    <Dialog size="x-large" variant="settings">
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitleGroup title={language.t("dialog.theme.select.title")} />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
        <TextInput
          type="search"
          appearance="base"
          class="!w-full"
          autofocus
          placeholder={language.t("dialog.theme.search.placeholder")}
          aria-label={language.t("dialog.theme.search.placeholder")}
          value={store.search}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          showClearButton={!!store.search}
          clearIcon="circle-xmark"
          clearLabel={language.t("common.clear")}
          onClearClick={() => setSearch("")}
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.altKey || event.metaKey) return

            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
              event.preventDefault()
              move(1, false)

              return
            }

            if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
              event.preventDefault()
              move(-1, false)

              return
            }

            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              selectActive()
            }
          }}
        />
        <Show
          when={visible().length > 0}
          fallback={
            <div class="flex flex-1 items-center justify-center text-[13px] leading-5 text-v2-text-text-faint">
              {language.t("dialog.theme.empty")}
            </div>
          }
        >
          <div
            ref={grid}
            role="radiogroup"
            aria-label={language.t("dialog.theme.select.title")}
            class="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto md:grid-cols-3 lg:grid-cols-4"
            onKeyDown={(event) => {
              if (event.altKey || event.metaKey || event.ctrlKey) return

              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault()
                move(1, true)

                return
              }

              if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault()
                move(-1, true)
              }
            }}
          >
            <For each={visible()}>
              {(option) => (
                <ThemeOptionCard
                  desktop={option.desktop}
                  name={option.name}
                  mode={theme.mode}
                  selected={option.id === theme.themeId()}
                  active={option.id === store.active}
                  onActivate={() => setStore("active", option.id)}
                  onSelect={() => select(option.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function ThemeOptionCard(props: {
  desktop: DesktopTheme
  name: string
  mode: Accessor<"light" | "dark">
  selected: boolean
  active: boolean
  onActivate: () => void
  onSelect: () => void
}) {
  const dark = () => props.mode() === "dark"
  const palette = createMemo(() => themePreviewPalette(dark() ? props.desktop.dark : props.desktop.light, dark()))

  return (
    <ThemeCard
      label={props.name}
      palette={palette()}
      data-theme-id={props.desktop.id}
      data-selected={props.selected ? "" : undefined}
      role="radio"
      aria-checked={props.selected}
      tabindex={props.active ? 0 : -1}
      onMouseEnter={props.onActivate}
      onFocus={props.onActivate}
      onClick={props.onSelect}
    />
  )
}
