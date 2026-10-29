import { Popover } from "@kobalte/core/popover"
import { For, Show, createSignal } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Mark } from "@opencode/ui/logo"
import { useCommand } from "@/shell/commands/command"
import { useSettingsSurface } from "@/settings/surface"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * SiCode: the bottom-left dock — a workspace trigger that opens a compact menu (identity line,
 * shortcuts into settings) instead of jumping straight to the settings dialog. `rail` is the 60px
 * icon column (square trigger, menu opens right); `pill` is the wide left sidebar (name row, menu
 * opens upward). Version lives in Settings → About, not here.
 */
export function DockToolbar(props: { variant?: "rail" | "pill" } = {}) {
  const language = useLanguage()
  const settings = useSettingsSurface()
  const command = useCommand()
  const [open, setOpen] = createSignal(false)
  const variant = () => props.variant ?? "rail"

  const go = (section: Parameters<ReturnType<typeof useSettingsSurface>["open"]>[0]) => {
    setOpen(false)
    settings.open(section)
  }

  const entries = () => [
    { icon: "providers", label: language.t("settings.providers.title"), onSelect: () => go("providers") },
    { icon: "extensions", label: language.t("settings.tab.extensions"), onSelect: () => go("extensions") },
    { icon: "appearance", label: language.t("settings.general.section.appearance"), onSelect: () => go("appearance") },
    {
      icon: "settings-gear",
      // "设置" rather than "打开设置": every row in this card opens something, so the verb was
      // noise, and the shorter label matches the sidebar's own settings entry.
      label: language.t("sidebar.settings"),
      keybind: command.keybindParts("settings.open"),
      onSelect: () => go("general"),
    },
  ]

  // SiCode: the About row used to carry the raw version as its right-hand hint, and a local build
  // stamp ("2.0.0-local-1793207008995") is wider than the label itself — the row collapsed to "关…".
  // Version now lives in the chip row above, so this row stays a plain menu item.
  const secondary = () => [{ icon: "info", label: language.t("dock.about"), onSelect: () => go("about") }]

  const row = (props: {
    icon: string
    label: string
    hint?: string
    keybind?: string[]
    onSelect: () => void
  }) => (
    <button
      type="button"
      role="menuitem"
      class="flex h-[30px] w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-start text-13-regular text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
      onClick={props.onSelect}
    >
      <Icon name={props.icon} class="size-4 shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      {props.keybind && props.keybind.length > 0 ? (
        <span class="shrink-0 text-11-regular tabular-nums text-v2-text-text-faint">{props.keybind.join("+")}</span>
      ) : undefined}
      {props.hint ? <span class="shrink-0 text-11-regular text-v2-text-text-faint">{props.hint}</span> : undefined}
    </button>
  )

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement={variant() === "pill" ? "top-start" : "right-end"}
      gutter={10}
      modal={false}
    >
      <Popover.Trigger
        as={Button}
        type="button"
        data-action="dock-toolbar"
        aria-label={language.t("dock.toolbar")}
        // The app icon is the control, not a glyph inside a button: a resting fill made the dock
        // read as one more square in a column of squares, and the mark already looks like a button
        // on its own. `ghost` keeps the surface transparent at rest and still answers the pointer —
        // a hover wash, and the pressed wash while the menu is open.
        data-state={open() ? "pressed" : undefined}
        variant="ghost"
        class={
          variant() === "pill"
            ? "flex h-auto w-full justify-start gap-2 rounded-[7px] p-[5px] text-start"
            : "size-7 shrink-0 rounded-[7px] p-0"
        }
      >
        <Show
          when={variant() === "pill"}
          fallback={
            // With no plate behind it the mark can take the square: 24px in a 28px control leaves
            // only the margin the pointer needs, so the artwork fills what the user is aiming at.
            <Mark class="size-6 shrink-0" />
          }
        >
          <span class="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-1 py-0.5">
            {/* SiCode: the identity slot carries the app icon, not a generic workspace glyph —
                the software mark is what the user recognises, and the PNG already brings its own
                rounded surface, so the tinted circle that used to hold the glyph is gone. */}
            <Mark class="size-[22px] shrink-0" />
            <span class="min-w-0 flex-1 truncate text-12-regular text-v2-text-text-base">
              {language.t("dock.identity")}
            </span>
          </span>
          <Icon name="chevron-up" class="me-1 size-3.5 shrink-0 text-v2-icon-icon-faint" />
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-slot="dock-toolbar"
          onOpenAutoFocus={(event: Event) => event.preventDefault()}
          onCloseAutoFocus={(event: Event) => event.preventDefault()}
          // Sized and styled like the app-wide context menu: same hairline inset border, layer-01
          // surface, 30px rows. 208px still fits the longest row ("关于 SiCode") and the keybind
          // column; with the version gone there is nothing left to fill a wider panel.
          class="z-50 w-[208px] rounded-[12px] bg-v2-background-bg-layer-01 p-1.5 shadow-[var(--v2-elevation-floating),inset_0_0_0_0.5px_var(--v2-border-border-base)] outline-none"
        >
          {/* SiCode: one plain row — app mark + name, nothing else — then a hairline that
              isolates it from the menu below. No description, no chips, no version: the user asked
              for exactly "本地工作区" up here. The mark matches the trigger that opened this card. */}
          <div class="flex items-center gap-2.5 px-2 py-2">
            <Mark class="size-7 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-13-regular font-medium text-v2-text-text-base">
              {language.t("dock.identity")}
            </span>
          </div>

          <div class="mx-2 my-1.5 h-px bg-v2-border-border-base" />

          <div class="flex flex-col">
            <For each={entries()}>{(entry) => row(entry)}</For>
          </div>

          <div class="mx-2 my-1.5 h-px bg-v2-border-border-base" />

          <div class="flex flex-col">
            <For each={secondary()}>{(entry) => row(entry)}</For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}
