import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { FileIcon } from "@opencode/ui/file-icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { useData } from "../context"
import type { TimelineRow } from "../timeline/timeline-row"
import "./artifact-capsules.css"

function fileName(path: string) {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return slash < 0 ? path : path.slice(slash + 1)
}

/**
 * SiCode: WorkBuddy-style deliverable capsules. New files only; click opens the side region
 * through the host's file link handler (HTML → browser pane). Older turns start folded.
 */
export function ArtifactCapsules(props: { row: TimelineRow.Artifacts }) {
  const i18n = useI18n()
  const data = useData()
  // Follow projection's collapsed flag until the reader toggles; reset when that flag moves.
  const [override, setOverride] = createSignal<boolean | undefined>()
  createEffect(() => {
    props.row.collapsed
    setOverride(undefined)
  })
  const expanded = createMemo(() => override() ?? !props.row.collapsed)

  return (
    <div data-component="artifact-capsules" data-collapsed={expanded() ? undefined : "true"}>
      <Show
        when={expanded()}
        fallback={
          <button type="button" data-slot="artifact-capsules-fold" onClick={() => setOverride(true)}>
            {i18n.plural("ui.artifact.capsules.folded", props.row.items.length)}
          </button>
        }
      >
        <div data-slot="artifact-capsules-list">
          <For each={[...props.row.items]}>
            {(item) => (
              <button
                type="button"
                data-slot="artifact-capsule"
                data-artifact-path={item.path}
                title={item.path}
                onClick={() => data.openFile?.(item.path)}
              >
                <FileIcon node={{ path: item.path, type: "file" }} />
                <span data-slot="artifact-capsule-name">{fileName(item.path)}</span>
              </button>
            )}
          </For>
        </div>
        <Show when={props.row.collapsed}>
          <button type="button" data-slot="artifact-capsules-fold" onClick={() => setOverride(false)}>
            {i18n.t("ui.artifact.capsules.hide")}
          </button>
        </Show>
      </Show>
    </div>
  )
}