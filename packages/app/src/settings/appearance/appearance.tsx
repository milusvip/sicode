import { Component, createMemo } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { createAppearanceSettingsController, type AppearanceSettingsController } from "@/settings/general/controllers"
import { type SessionWidth, useSettings } from "@/settings/model"
import "@/settings/settings.css"

const schemeOptions: ("system" | "light" | "dark")[] = ["system", "light", "dark"]

const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
    font: "ui",
    input: "setUI",
  },
  code: {
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
    font: "code",
    input: "setCode",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
    font: "terminal",
    input: "setTerminal",
  },
} as const

const SessionWidthSetting: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  // Three choices in the UI; a persisted "extra" (removed from the menu) reads as wide.
  const options = createMemo((): { value: Exclude<SessionWidth, "extra">; label: string }[] => [
    { value: "default", label: language.t("settings.appearance.row.sessionWidth.default") },
    { value: "wide", label: language.t("settings.appearance.row.sessionWidth.wide") },
    { value: "full", label: language.t("settings.appearance.row.sessionWidth.full") },
  ])

  const current = createMemo(() => {
    const value = settings.appearance.sessionWidth()
    const mapped = value === "extra" ? "wide" : value

    return options().find((option) => option.value === mapped)
  })

  return (
    <SettingsRow
      title={language.t("settings.appearance.row.sessionWidth.title")}
      description={language.t("settings.appearance.row.sessionWidth.description")}
    >
      <Select
        data-action="settings-session-width"
        options={options()}
        current={current()}
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && settings.appearance.setSessionWidth(option.value)}
      />
    </SettingsRow>
  )
}

const FontSetting: Component<{
  kind: "ui" | "code" | "terminal"
  fonts: AppearanceSettingsController["fonts"]
}> = (props) => {
  const language = useLanguage()
  const config = () => fontSettings[props.kind]

  return (
    <SettingsRow title={language.t(config().title)} description={language.t(config().description)}>
      <div class="w-full sm:w-[220px]">
        <TextInput
          data-action={config().action}
          type="text"
          appearance="base"
          value={props.fonts[config().font]().value}
          onInput={(event) => props.fonts[config().input](event.currentTarget.value)}
          placeholder={props.fonts[config().font]().placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={language.t(config().title)}
          style={{ "font-family": props.fonts[config().font]().family }}
        />
      </div>
    </SettingsRow>
  )
}

export const SettingsAppearance: Component = () => {
  const language = useLanguage()
  const appearance = createAppearanceSettingsController()
  const dialog = useDialog()

  // The theme picker is reachable only from this row, so it loads on first open.
  const openThemeDialog = () =>
    void import("./theme-dialog").then((mod) => dialog.show(() => <mod.DialogThemeSelect />))

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.general.section.appearance")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.appearance.description")}</span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <div class="settings-section">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.general.row.colorScheme.title")}
              description={language.t("settings.general.row.colorScheme.description")}
            >
              <Select
                data-action="settings-color-scheme"
                options={schemeOptions}
                current={schemeOptions.find((option) => option === appearance.scheme.current())}
                placement="bottom-end"
                gutter={6}
                label={(option) => {
                  if (option === "system") return language.t("theme.scheme.system")

                  if (option === "light") return language.t("theme.scheme.light")

                  return language.t("theme.scheme.dark")
                }}
                onSelect={(option) => option && appearance.scheme.select(option)}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.theme.title")}
              description={
                <>
                  {language.t("settings.general.row.theme.description")}{" "}
                  <ExternalLink class="settings-link" href="https://opencode.ai/v2/docs/themes">
                    {language.t("common.learnMore")}
                  </ExternalLink>
                </>
              }
            >
              <Button
                data-action="settings-theme"
                variant="ghost"
                size="small"
                aria-haspopup="dialog"
                onClick={openThemeDialog}
              >
                {appearance.theme.current()?.name}
                <Icon name="chevron-down" class="text-v2-icon-icon-muted" />
              </Button>
            </SettingsRow>

            <SessionWidthSetting />
            <FontSetting kind="ui" fonts={appearance.fonts} />
            <FontSetting kind="code" fonts={appearance.fonts} />
            <FontSetting kind="terminal" fonts={appearance.fonts} />
          </SettingsList>
        </div>
      </div>
    </>
  )
}
