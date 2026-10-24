import { useDialog } from "@opencode/ui/context/dialog"
import { Logo, Mark } from "@opencode/ui/logo"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
import { showToast } from "@/shell/notifications/toast"

const REPO = "https://github.com/milusvip/sicode"
const UPSTREAM = "https://github.com/sst/opencode"
const UPSTREAM_CONTRIBUTORS = "https://github.com/sst/opencode/graphs/contributors"

// SiCode: replace the upstream OpenCode colophon with a short product page
// (version, license, upstream credit) so branding and copyright stay accurate.
export function SettingsAbout(_props: { active: boolean }) {
  const language = useLanguage()
  const dialog = useDialog()
  const platform = usePlatform()

  const showNotices = async () => {
    // The license texts load only when someone reads them.
    const loaded = await import("./notices/dialog").catch(() => undefined)

    if (!loaded) {
      showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") })

      return
    }

    void dialog.show(() => <loaded.default />)
  }

  return (
    <div class="settings-about-content">
      <div class="settings-about-brand" role="img" aria-label="SiCode">
        <Mark class="settings-about-mark" />
        <Logo class="settings-about-wordmark" />
      </div>

      <div class="settings-about-meta">
        <p>
          {language.t("settings.about.version", {
            version: platform.version ?? language.t("settings.about.devVersion"),
          })}
        </p>
        <p>{language.t("settings.about.license")}</p>
      </div>

      <div class="settings-about-body">
        <p>{language.t("settings.about.description")}</p>
        <p>
          {language.rich("settings.about.basedOn", {
            project: (
              <ExternalLink href={UPSTREAM}>
                <bdi dir="ltr">OpenCode</bdi>
              </ExternalLink>
            ),
          })}
        </p>
        <p class="settings-about-faint">
          {language.rich("settings.about.thanks", {
            contributors: (
              <ExternalLink href={UPSTREAM_CONTRIBUTORS}>
                {language.t("settings.about.contributors")}
              </ExternalLink>
            ),
          })}
        </p>
      </div>

      <div class="settings-about-links">
        <p>
          <ExternalLink href={REPO}>
            <bdi dir="ltr">{language.t("settings.about.website")}</bdi>
          </ExternalLink>
        </p>
        <p>
          <button type="button" class="settings-about-link" onClick={() => void showNotices()}>
            {language.t("settings.about.notices.title")}
          </button>
        </p>
      </div>
    </div>
  )
}
