import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { useFilteredList } from "@opencode/ui/hooks"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { createMemo, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/providers/models/selection"
import { isFreeModel } from "@/providers/models/models"
import { providerDisplay } from "@/providers/models/display"
import {
  compareProviderOrder,
  reorderProviderOrder,
  useModelSelectorPrefs,
} from "@/providers/models/prefs"
import { useLanguage } from "@/runtime/i18n/language"
import { useDialog } from "@opencode/ui/context/dialog"
import { DialogConnectProvider } from "@/providers/connect/dialog"
import { decode64 } from "@/runtime/persistence/base64"
import "@/settings/settings.css"
import "./manage.css"

type ModelItem = ReturnType<ReturnType<typeof useLocal>["model"]["list"]>[number]
type ModelGroup = { category: string; items: ModelItem[] }

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const [prefs, setPrefs] = useModelSelectorPrefs()
  const [store, setStore] = createStore<{ expanded: Record<string, boolean> }>({ expanded: {} })
  const directory = () => decode64(local.slug())

  const handleConnectProvider = () => {
    void dialog.show(() => <DialogConnectProvider directory={directory()} />)
  }

  const setProviderVisibility = (providerID: string, checked: boolean) => {
    local.model
      .list()
      .filter((item) => item.provider.id === providerID)
      .forEach((item) => {
        local.model.setVisibility({ modelID: item.id, providerID: item.provider.id }, checked)
      })
  }

  const setModelVisibility = (item: ModelItem, checked: boolean) => {
    local.model.setVisibility({ modelID: item.id, providerID: item.provider.id }, checked)
  }

  const providerVisible = (group: ModelGroup) =>
    group.items.every((item) => local.model.visible({ modelID: item.id, providerID: item.provider.id }))

  const list = useFilteredList<ModelItem>({
    items: () => local.model.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
  })

  const searching = () => list.filter().length > 0
  const expanded = (key: string) => searching() || !!store.expanded[key]

  const byProviderOrder = (a: ModelGroup, b: ModelGroup) =>
    compareProviderOrder(
      { id: a.category, name: providerDisplay(a.items[0].provider).title },
      { id: b.category, name: providerDisplay(b.items[0].provider).title },
      prefs.providerOrder,
    )

  // Sort outside useFilteredList — its resource does not track prefs.providerOrder.
  const sections = createMemo(() => {
    const groups = (list.grouped.latest as ModelGroup[]) ?? []
    const mine = groups.filter((group) => !group.items.every(isFreeModel)).slice().sort(byProviderOrder)
    const free = groups.filter((group) => group.items.every(isFreeModel)).slice().sort(byProviderOrder)

    return [
      { key: "mine" as const, title: language.t("dialog.model.manage.section.mine"), groups: mine },
      { key: "free" as const, title: language.t("dialog.model.manage.section.free"), groups: free },
    ].filter((section) => section.groups.length > 0)
  })

  const freeTitle = (group: ModelGroup) =>
    group.category === "opencode" && group.items.every((item) => !item.cost?.input)
      ? language.t("provider.connect.opencode.freeName")
      : providerDisplay(group.items[0].provider).title

  const commitOrder = (ids: string[], from: number, to: number) => {
    if (from === to) return
    setPrefs("providerOrder", reorderProviderOrder(prefs.providerOrder, ids, from, to))
  }

  return (
    <Dialog size="large" variant="settings" class="settings-manage-models-dialog">
      <DialogHeader hideClose={true} closeLabel={language.t("common.close")}>
        <DialogTitleGroup
          title={language.t("dialog.model.manage")}
          description={language.t("dialog.model.manage.description")}
        />
        <Button variant="neutral" icon="plus" onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col">
        <div class="px-4 pt-px pb-2">
          <TextInput
            type="search"
            appearance="base"
            class="!w-full self-stretch"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("dialog.model.manage.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            autofocus
            aria-label={language.t("dialog.model.manage.search.placeholder")}
            showClearButton={!!list.filter()}
            clearIcon="circle-xmark"
            clearLabel={language.t("common.clear")}
            onClearClick={() => list.clear()}
          />
        </div>
        <div data-slot="manage-models-scroll" class="relative min-h-0 flex-1">
          <div class="settings-panel mm-panel h-full px-4 pt-1 pb-3">
            <Show
              when={!list.grouped.loading}
              fallback={
                <div class="settings-models-status">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={list.flat().length > 0}
                fallback={
                  <div class="settings-models-status">
                    <span>{language.t("dialog.model.empty")}</span>
                    <Show when={list.filter()}>
                      <span class="settings-models-status-filter">&quot;{list.filter()}&quot;</span>
                    </Show>
                  </div>
                }
              >
                <For each={sections()}>
                  {(section) => (
                    <ProviderSection
                      title={section.title}
                      groups={section.groups}
                      free={section.key === "free"}
                      freeTitle={freeTitle}
                      searching={searching()}
                      expanded={expanded}
                      onExpand={(id) => setStore("expanded", id, !expanded(id))}
                      providerVisible={providerVisible}
                      onProviderVisibility={setProviderVisibility}
                      modelVisible={(item) =>
                        local.model.visible({ modelID: item.id, providerID: item.provider.id })
                      }
                      onModelVisibility={setModelVisibility}
                      reorderLabel={language.t("dialog.model.manage.reorder")}
                      onReorder={commitOrder}
                    />
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

function ProviderSection(props: {
  title: string
  groups: ModelGroup[]
  free: boolean
  freeTitle: (group: ModelGroup) => string
  searching: boolean
  expanded: (id: string) => boolean
  onExpand: (id: string) => void
  providerVisible: (group: ModelGroup) => boolean
  onProviderVisibility: (providerID: string, checked: boolean) => void
  modelVisible: (item: ModelItem) => boolean
  onModelVisibility: (item: ModelItem, checked: boolean) => void
  reorderLabel: string
  onReorder: (ids: string[], from: number, to: number) => void
}) {
  let listRef!: HTMLDivElement
  // String keys keep row nodes alive while the group objects refresh.
  const ids = createMemo(() => props.groups.map((group) => group.category))
  const byID = createMemo(() => new Map(props.groups.map((group) => [group.category, group] as const)))

  return (
    <div class="mm-section">
      <div class="mm-section-label">{props.title}</div>
      <DragDropProvider
        sensors={(defaults) => [
          ...defaults.filter((sensor) => sensor !== PointerSensor),
          PointerSensor.configure({
            activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
          }),
        ]}
        modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => listRef })]}
        plugins={(defaults) => [
          ...defaults.filter((plugin) => plugin !== AutoScroller && plugin !== Feedback),
          AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
          Feedback.configure({ dropAnimation: null }),
        ]}
        onDragEnd={(event) => {
          const source = event.operation.source

          if (event.canceled || !isSortable(source)) return
          if (source.initialIndex === source.index) return
          props.onReorder(ids(), source.initialIndex, source.index)
        }}
      >
        <div ref={listRef} class="mm-sheet">
          <For each={ids()}>
            {(id, index) => {
              const group = () => byID().get(id)

              return (
                <Show when={group()} keyed>
                  {(item) => (
                    <ProviderRow
                      group={item}
                      index={index()}
                      title={props.free ? props.freeTitle(item) : providerDisplay(item.items[0].provider).title}
                      subtitle={providerDisplay(item.items[0].provider).subtitle}
                      open={props.expanded(id)}
                      searching={props.searching}
                      allOn={props.providerVisible(item)}
                      reorderLabel={props.reorderLabel}
                      onExpand={() => props.onExpand(id)}
                      onProviderVisibility={(checked) => props.onProviderVisibility(id, checked)}
                      modelVisible={props.modelVisible}
                      onModelVisibility={props.onModelVisibility}
                    />
                  )}
                </Show>
              )
            }}
          </For>
        </div>
      </DragDropProvider>
    </div>
  )
}

function ProviderRow(props: {
  group: ModelGroup
  index: number
  title: string
  subtitle?: string
  open: boolean
  searching: boolean
  allOn: boolean
  reorderLabel: string
  onExpand: () => void
  onProviderVisibility: (checked: boolean) => void
  modelVisible: (item: ModelItem) => boolean
  onModelVisibility: (item: ModelItem, checked: boolean) => void
}) {
  const sortable = useSortable({
    get id() {
      return props.group.category
    },
    get index() {
      return props.index
    },
    get disabled() {
      return props.searching
    },
  })

  return (
    <section
      ref={sortable.ref}
      class="mm-item"
      data-provider={props.group.category}
      data-dragging={sortable.isDragSource() ? "" : undefined}
    >
      <div class="mm-row">
        <button
          ref={sortable.handleRef}
          type="button"
          class="mm-handle"
          disabled={props.searching}
          aria-label={props.reorderLabel}
          title={props.reorderLabel}
        >
          <span class="mm-handle-dots" aria-hidden="true">
            <For each={[0, 1, 2, 3, 4, 5]}>{() => <span />}</For>
          </span>
        </button>

        <button
          type="button"
          class="mm-chevron"
          aria-expanded={props.open}
          aria-label={props.title}
          onClick={() => props.onExpand()}
        >
          <Icon name="chevron-down" size="small" />
        </button>

        <button type="button" class="mm-who" aria-expanded={props.open} onClick={() => props.onExpand()}>
          <span class="mm-title">{props.title}</span>
          <Show when={props.subtitle}>{(url) => <span class="mm-url">{url()}</span>}</Show>
        </button>

        <div class="mm-switch" data-action="manage-provider-visibility">
          <Switch appearance="compact" checked={props.allOn} onChange={props.onProviderVisibility} hideLabel>
            {props.title}
          </Switch>
        </div>
      </div>

      <Show when={props.open}>
        <div class="mm-models">
          <For each={props.group.items}>
            {(item) => (
              <div class="mm-model">
                <div class="mm-model-name">{item.name}</div>
                <Switch
                  appearance="compact"
                  checked={props.modelVisible(item)}
                  onChange={(checked) => props.onModelVisibility(item, checked)}
                  hideLabel
                >
                  {item.name}
                </Switch>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
