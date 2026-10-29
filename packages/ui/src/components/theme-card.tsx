import { type ComponentProps, splitProps } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import type { ThemePreviewPalette } from "@opencode/ui/theme/preview"

export interface ThemeCardProps extends Omit<ComponentProps<"button">, "children"> {
  /** Theme name, shown above the preview. */
  label: string
  palette: ThemePreviewPalette
}

/** Selectable theme option: a miniature app window painted with the theme's own palette. */
export function ThemeCard(props: ThemeCardProps) {
  const [local, buttonProps] = splitProps(props, ["label", "palette", "class", "classList"])

  return (
    <button
      {...buttonProps}
      type="button"
      data-component="theme-card"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <span data-slot="theme-card-head">
        <span data-slot="theme-card-name">{local.label}</span>
        {/* `Icon` sets its own `data-slot` after spreading props, so the slot has to wrap it. */}
        <span data-slot="theme-card-check">
          <Icon name="check" size="small" />
        </span>
      </span>
      <span data-slot="theme-card-window" style={{ background: local.palette.surface }}>
        <span data-slot="theme-card-titlebar" style={{ background: local.palette.chrome }}>
          <i style={{ background: local.palette.danger }} />
          <i style={{ background: local.palette.info }} />
          <i style={{ background: local.palette.success }} />
        </span>
        <span data-slot="theme-card-body">
          <span data-slot="theme-card-line" style={{ background: local.palette.ink, width: "62%" }} />
          <span data-slot="theme-card-line" style={{ background: local.palette.track, width: "88%" }} />
          <span data-slot="theme-card-split">
            <span data-slot="theme-card-rail" style={{ background: local.palette.chrome }} />
            <span data-slot="theme-card-main">
              <span data-slot="theme-card-line" style={{ background: local.palette.accent, width: "74%" }} />
              <span data-slot="theme-card-line" style={{ background: local.palette.track, width: "96%" }} />
              <span data-slot="theme-card-line" style={{ background: local.palette.highlight, width: "52%" }} />
            </span>
          </span>
        </span>
      </span>
    </button>
  )
}
