import { Spinner } from "@opencode/ui/spinner"
import { useLanguage } from "@/runtime/i18n/language"

/**
 * SiCode: a routed session loads its transcript asynchronously, and the panel used to draw nothing
 * until the first page arrived — on startup that reads as a blank window rather than as waiting.
 */
export function SessionLoadingState() {
  const language = useLanguage()

  return (
    <div
      role="status"
      aria-live="polite"
      class="flex min-h-0 flex-1 items-center justify-center gap-2 text-[13px] font-[440] leading-text-compact text-v2-text-text-muted"
    >
      <Spinner class="size-4 shrink-0 text-v2-icon-icon-muted" />
      <span>{language.t("session.messages.loading")}</span>
    </div>
  )
}
