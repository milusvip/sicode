import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { Keybind } from "@opencode/ui/keybind"
import { Mark } from "@opencode/ui/logo"
import { useCommand } from "@/shell/commands/command"
import { useSettingsSurface } from "@/settings/surface"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"

// SiCode: 左侧窄工具栏。保留顶部水平标签栏，新增一列常驻入口（软件图标 / 主页 / 新建 / 帮助 / 设置），
// 解决「打开设置要先回主页」的问题。与 vertical-tabs 侧栏互斥（horizontal 时才渲染）。
export function ToolRail() {
  const command = useCommand()
  const settings = useSettingsSurface()
  const language = useLanguage()
  const layout = useLayout()

  const railButton = (props: {
    label: string
    icon: string
    keybind?: string
    active?: boolean
    onClick: () => void
  }) => (
    <Tooltip
      placement="right"
      value={
        <>
          {props.label}
          {props.keybind ? <Keybind keys={command.keybindParts(props.keybind)} variant="neutral" /> : null}
        </>
      }
    >
      <button
        type="button"
        data-slot="tool-rail-button"
        aria-label={props.label}
        aria-current={props.active ? "page" : undefined}
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[active=true]:text-v2-text-text-base"
        onClick={props.onClick}
      >
        <Icon name={props.icon} />
      </button>
    </Tooltip>
  )

  return (
    <aside
      data-slot="tool-rail"
      class="flex h-full min-h-0 w-[60px] shrink-0 flex-col items-center gap-1.5 border-e border-v2-border-border-muted bg-v2-background-bg-deep pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]"
    >
      <Tooltip placement="right" value="SiCode">
        <button
          type="button"
          data-slot="tool-rail-app"
          aria-label="SiCode"
          class="mb-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] transition-opacity hover:opacity-80"
          onClick={() => command.trigger("home.toggle")}
        >
          <Mark class="size-7" />
        </button>
      </Tooltip>

      {railButton({
        label: language.t("home.title"),
        icon: "grid-plus",
        keybind: "home.toggle",
        active: layout.route().type === "home",
        onClick: () => command.trigger("home.toggle"),
      })}

      <div class="flex-1" aria-hidden="true" />

      {railButton({
        label: language.t("command.settings.open"),
        icon: "settings-gear",
        keybind: "settings.open",
        onClick: () => settings.open("general"),
      })}
    </aside>
  )
}
