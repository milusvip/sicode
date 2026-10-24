import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useSessionLayout } from "@/session/session-layout"

export function SessionReviewToggle() {
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const { view } = useSessionLayout()

  // SiCode: the header control owns the whole side column — side tabs and a side-placed terminal.
  // Closing the dock must be reversible: remember what was showing and restore on the next open.
  let restoreSide = false
  let restoreDock = false

  const sideDocked = () => settings.general.terminalPlacement() === "side"

  const sideColumnOpen = () => {
    if (view().side.opened()) return true

    return sideDocked() && view().dock.opened()
  }

  const toggleSideColumn = () => {
    if (sideColumnOpen()) {
      restoreSide = view().side.opened()
      restoreDock = sideDocked() && view().dock.opened()
      view().side.close()

      if (sideDocked()) view().dock.close()

      return
    }

    if (restoreSide || !restoreDock) {
      if (!view().side.opened()) view().side.toggle()
    }

    if (restoreDock && sideDocked()) view().dock.open()
  }

  return (
    <SessionHeaderActions
      state={{
        reviewLabel: language.t("command.review.toggle"),
        reviewKeybind: command.keybindParts("review.toggle"),
        reviewVisible: true,
        reviewOpened: sideColumnOpen(),
        onReviewToggle: toggleSideColumn,
      }}
    />
  )
}

export type SessionHeaderActionsState = {
  reviewLabel: string
  reviewKeybind: string[]
  reviewVisible: boolean
  reviewOpened: boolean
  onReviewToggle: () => void
}

export function SessionHeaderActions(props: { state: SessionHeaderActionsState }) {
  return (
    <div class="flex items-center gap-2">
      <Show when={props.state.reviewVisible}>
        <Tooltip
          class="shrink-0"
          placement="bottom"
          value={
            <>
              {props.state.reviewLabel}
              <Show when={props.state.reviewKeybind.length > 0}>
                <Keybind keys={props.state.reviewKeybind} variant="neutral" />
              </Show>
            </>
          }
        >
          <IconButton
            type="button"
            variant="ghost-muted"
            size="large"
            class="shrink-0"
            style={{
              // This fixed control sits above moving panel contents.
              "--v2-overlay-simple-overlay-hover": "var(--v2-background-bg-layer-01)",
              "--v2-overlay-simple-overlay-pressed": "var(--v2-background-bg-layer-02)",
            }}
            state={props.state.reviewOpened ? "pressed" : undefined}
            onClick={props.state.onReviewToggle}
            aria-label={props.state.reviewLabel}
            aria-expanded={props.state.reviewOpened}
            aria-controls="review-panel"
            icon={<Icon name="sidebar-right" />}
          />
        </Tooltip>
      </Show>
    </div>
  )
}
