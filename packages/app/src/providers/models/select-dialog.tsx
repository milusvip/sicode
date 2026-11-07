import { Popover } from "@kobalte/core/popover"
import { Component, ComponentProps, createEffect, createMemo, For, JSX, Show, Suspense, lazy, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { isFreeModel } from "@/providers/models/models"
import { providerDisplay } from "@/providers/models/display"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { Menu } from "@opencode/ui/menu"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { ModelTooltip } from "./tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { decode64 } from "@/runtime/persistence/base64"
import { handleDocumentSearchKeydown } from "@/shell/commands/search-keydown"
import { createMenuDismissController } from "@/shell/commands/menu-dismiss"
import { createEventListener } from "@solid-primitives/event-listener"
import { matchesModelSearch } from "./search"
import { SettingsList } from "@/settings/list"
import {
  CONSOLE_GROUP_KEY,
  consoleModelGroup,
  ProviderModelIcon,
  ProviderModelSections,
} from "@/providers/models/provider-group"
import { consoleProviderName } from "@/providers/catalog/console"
import {
  compareProviderOrder,
  useModelSelectorPrefs,
  type ModelSelectorTab,
} from "@/providers/models/prefs"
import "@/settings/settings.css"
import "./select-dialog.css"

type ModelTab = ModelSelectorTab

const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")

  return { default: MobilePanelDrawer }
})

type ModelState = ModelSelection

type ModelItem = ReturnType<ModelState["list"]>[number]

const modelKey = (model: ModelItem) => `${model.provider.id}:${model.id}`

const manageKey = "action:manage"

function resolveOpenTab(input: {
  current?: string
  remembered: ModelTab
  models: (search: string, tab: ModelTab) => ModelItem[]
}): ModelTab {
  if (input.current) {
    if (input.models("", "mine").some((item) => modelKey(item) === input.current)) return "mine"
    if (input.models("", "free").some((item) => modelKey(item) === input.current)) return "free"
    if (input.models("", "all").some((item) => modelKey(item) === input.current)) return "all"
  }

  if (input.models("", input.remembered).length > 0) return input.remembered

  if (input.models("", "mine").length > 0) return "mine"
  if (input.models("", "free").length > 0) return "free"
  return "all"
}

const sortModelGroups =
  (order: readonly string[]) =>
  (a: { category: string; items: ModelItem[] }, b: { category: string; items: ModelItem[] }) =>
    compareProviderOrder(
      { id: a.category, name: providerDisplay(a.items[0].provider).title },
      { id: b.category, name: providerDisplay(b.items[0].provider).title },
      order,
    )

const ModelList: Component<{
  mobile?: boolean
  open?: boolean
  provider?: string
  onSelect: () => void
  model?: ModelState
}> = (props) => {
  const language = useLanguage()

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: props.onSelect,
  })
  const [prefs, setPrefs] = useModelSelectorPrefs()

  const [store, setStore] = createStore<{
    search: string
    tab: ModelTab
    active: string
    collapsed: Record<string, boolean>
  }>({
    search: "",
    tab: prefs.tab,
    active: props.mobile ? (controller.current() ?? "") : "",
    collapsed: {},
  })

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!props.mobile || !open) return
        const tab = resolveOpenTab({
          current: controller.current(),
          remembered: prefs.tab,
          models: controller.models,
        })
        setStore({ search: "", tab, active: controller.current() ?? "" })
      },
    ),
  )
  const models = createMemo(() => controller.models(store.search, store.tab))
  const modelGroups = createMemo(() => controller.groups(models()))
  const managed = createMemo(() => consoleModelGroup(controller.all()))
  const expanded = (provider: string) => store.search.length > 0 || !store.collapsed[provider]
  const managedIDs = createMemo(() => new Set(managed()?.providers.map((provider) => provider.id) ?? []))

  const visibleModels = () =>
    models().filter(
      (item) => expanded(item.provider.id) && (!managedIDs().has(item.provider.id) || expanded(CONSOLE_GROUP_KEY)),
    )

  let scrollRef: HTMLDivElement | undefined

  const setSearch = (value: string) => {
    const first = controller
      .models(value, store.tab)
      .find((item) => value.length > 0 || !store.collapsed[item.provider.id])
    setStore({ search: value, active: first ? modelKey(first) : "" })
  }

  const setTab = (tab: ModelTab) => {
    const first = controller.models(store.search, tab)[0]
    setPrefs("tab", tab)
    setStore({ tab, active: first ? modelKey(first) : "" })
  }

  const moveActive = (delta: number) => {
    const keys = visibleModels().map(modelKey)

    if (keys.length === 0) return
    const index = keys.indexOf(store.active)
    const start = index === -1 ? (delta > 0 ? -1 : 0) : index
    setStore("active", keys[(start + delta + keys.length) % keys.length])
    queueMicrotask(() => {
      scrollRef
        ?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    })
  }

  const selectActive = () => {
    const item = visibleModels().find((item) => modelKey(item) === store.active)

    if (item) controller.select(item)
  }

  function ModelRows(props: { items: ModelItem[]; mobile?: boolean }) {
    return (
      <SettingsList variant="catalog">
        <For each={props.items}>
          {(item) => {
            const shown = () => controller.visible(item)

            return (
              <div
                data-component="settings-row"
                data-option-key={modelKey(item)}
                class="-mx-4 flex w-[calc(100%+32px)] items-center gap-2 px-4 first:rounded-t-lg last:rounded-b-lg hover:bg-v2-overlay-simple-overlay-hover"
                classList={{ "bg-v2-overlay-simple-overlay-hover": store.active === modelKey(item) }}
                onMouseEnter={() => setStore("active", modelKey(item))}
                onMouseLeave={() => setStore("active", "")}
              >
                <button
                  type="button"
                  aria-pressed={controller.current() === modelKey(item)}
                  class="flex min-w-0 flex-1 items-center gap-2 py-2 text-start focus-visible:outline-none"
                  onClick={() => {
                    setPrefs("tab", store.tab)
                    controller.select(item)
                  }}
                >
                  <div data-slot="settings-row-copy" class="min-w-0 flex-1">
                    <div data-slot="settings-row-title" class="flex items-center gap-2">
                      <Tooltip
                        inactive={props.mobile}
                        placement="right-start"
                        gutter={12}
                        openDelay={0}
                        value={<ModelTooltip model={item} latest={item.latest} free={isFreeModel(item)} v2 />}
                      >
                        <span class="min-w-0 truncate">{item.name}</span>
                      </Tooltip>
                      <Show when={isFreeModel(item)}>
                        <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
                      </Show>
                      <Show when={!shown()}>
                        <Badge class="shrink-0">{language.t("dialog.model.hidden")}</Badge>
                      </Show>
                      <Show when={item.latest}>
                        <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
                      </Show>
                    </div>
                  </div>
                  <div data-slot="settings-row-control" class="size-4">
                    <Show when={controller.current() === modelKey(item)}>
                      <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-base" />
                    </Show>
                  </div>
                </button>
                <div
                  class="shrink-0"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Switch
                    checked={shown()}
                    onChange={(checked) => controller.setVisibility(item, checked)}
                    hideLabel
                  >
                    {item.name}
                  </Switch>
                </div>
              </div>
            )
          }}
        </For>
      </SettingsList>
    )
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div data-slot="model-selector-search" class="shrink-0 pt-px pb-3" classList={{ "px-4": !props.mobile }}>
        <TextInput
          type="search"
          appearance="base"
          class="!w-full self-stretch"
          placeholder={language.t("dialog.model.search.placeholder.rich")}
          value={store.search}
          autofocus={!props.mobile}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.altKey || event.metaKey) return

            if (event.key === "ArrowDown") {
              event.preventDefault()
              moveActive(1)

              return
            }

            if (event.key === "ArrowUp") {
              event.preventDefault()
              moveActive(-1)

              return
            }

            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              selectActive()
            }
          }}
          aria-label={language.t("dialog.model.search.placeholder.rich")}
          showClearButton={!!store.search}
          clearIcon="circle-xmark"
          clearLabel={language.t("common.clear")}
          onClearClick={() => setSearch("")}
        />
      </div>
      <div class="shrink-0 pb-2" classList={{ "px-4": !props.mobile }}>
        <SegmentedControl
          class="segmented-control-v2--full-width !w-full"
          value={store.tab}
          onChange={(value) => {
            if (value === "mine" || value === "free" || value === "all") setTab(value)
          }}
        >
          <SegmentedControlItem value="mine">{language.t("dialog.model.tab.mine")}</SegmentedControlItem>
          <SegmentedControlItem value="free">{language.t("dialog.model.tab.free")}</SegmentedControlItem>
          <SegmentedControlItem value="all">{language.t("dialog.model.tab.all")}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div class="relative min-h-0" classList={{ "flex-1": !props.mobile }}>
        <div
          ref={(element) => (scrollRef = element)}
          class="settings-panel settings-models pt-1 pb-4"
          classList={{ "h-full px-4": !props.mobile, "max-h-[min(360px,40dvh)]": props.mobile }}
        >
          <Show
            when={models().length > 0}
            fallback={<div class="settings-models-status">{language.t("dialog.model.empty")}</div>}
          >
            <ProviderModelSections
              groups={modelGroups()}
              managed={managed()}
              expanded={expanded}
              disabled={store.search.length > 0}
              onExpandedChange={(key, value) => setStore("collapsed", key, !value)}
              rows={(items) => <ModelRows items={items} mobile={props.mobile} />}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Popover.Trigger>, "as" | "ref">

type ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => JSX.Element

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  unpaid?: boolean
  trigger: ModelSelectorTrigger
  onClose?: () => void
}) {
  const dialog = useDialog()
  const mobile = createMediaQuery("(max-width: 767px)")
  const data = useData()
  const location = useWorkspaceLocation()

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => props.onClose?.(),
  })

  const chatgptPlan = () => {
    if (!controller.current()?.startsWith("openai:")) return false

    const connection = data.location.integration
      .list(location().ref)
      ?.find((integration) => integration.id === "openai")?.connections[0]

    return connection?.type === "credential" && connection.method === "oauth"
  }

  const manage = async () => {
    const { DialogManageModels } = await import("./manage")
    void dialog.show(() => <DialogManageModels />)
  }

  const connect = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => <DialogConnectProvider directory={location().directory} />)
  }

  return (
    <Show
      when={mobile()}
      fallback={
        <ModelSelectorPopoverView
          trigger={props.trigger}
          all={controller.all}
          models={controller.models}
          groups={controller.groups}
          current={controller.current()}
          visible={controller.visible}
          setVisibility={controller.setVisibility}
          chatgptPlan={chatgptPlan()}
          select={controller.select}
          onManage={manage}
          onClose={() => props.onClose?.()}
        />
      }
    >
      <ModelSelectorDrawer
        trigger={props.trigger}
        model={props.model}
        provider={props.provider}
        onConnect={props.unpaid ? connect : undefined}
        chatgptPlan={chatgptPlan()}
        onClose={() => props.onClose?.()}
        onManage={manage}
      />
    </Show>
  )
}

function ModelSelectorDrawer(props: {
  trigger: ModelSelectorTrigger
  model?: ModelState
  provider?: string
  chatgptPlan?: boolean
  onClose: () => void
  onManage: () => void
  onConnect?: () => void
}) {
  const language = useLanguage()

  const [store, setStore] = createStore<{
    open: boolean
    loaded: boolean
    restoreTrigger: boolean
    action?: "select" | "manage" | "connect"
  }>({
    open: false,
    loaded: false,
    restoreTrigger: true,
  })

  let trigger: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  return (
    <>
      <div ref={trigger} class="min-w-0">
        {props.trigger({
          "aria-haspopup": "dialog",
          get "aria-expanded"() {
            return store.open
          },
          onClick: () => setStore({ open: true, loaded: true, restoreTrigger: true }),
        })}
      </div>
      <Show when={store.loaded}>
        <Suspense>
          <MobilePanelDrawer
            hideHeader
            title={language.t("dialog.model.select.title")}
            open={store.open}
            onOpenChange={(open) => setStore("open", open)}
            initialFocus={() => content}
            returnFocus={() => trigger?.querySelector("button") ?? undefined}
            onFinalFocus={(event) => {
              if (!store.restoreTrigger) event.preventDefault()
            }}
            onContentPresentChange={(present) => {
              if (present) return
              const action = store.action
              setStore("action", undefined)

              if (action === "manage") {
                props.onManage()

                return
              }

              if (action === "connect") {
                props.onConnect?.()

                return
              }

              if (action === "select") queueMicrotask(props.onClose)
            }}
          >
            <div
              ref={content}
              tabIndex={-1}
              data-slot="model-selector-drawer"
              class="flex min-h-0 flex-col gap-2 outline-none"
            >
              <div class="flex min-h-0 flex-col">
                <ModelList
                  mobile
                  open={store.open}
                  model={props.model}
                  provider={props.provider}
                  onSelect={() => setStore({ open: false, action: "select", restoreTrigger: false })}
                />
              </div>
              <div data-slot="model-selector-actions" class="flex flex-col gap-2">
                <Button
                  variant="ghost"
                  class="w-full !h-10 !justify-start"
                  icon="outline-sliders"
                  onClick={() => setStore({ open: false, action: "manage", restoreTrigger: false })}
                >
                  {language.t("dialog.model.manage")}
                </Button>
                <Show when={props.onConnect}>
                  <Button
                    variant="ghost"
                    class="w-full !h-10 !justify-start"
                    icon="plus"
                    onClick={() => setStore({ open: false, action: "connect", restoreTrigger: false })}
                  >
                    {language.t("command.provider.connect")}
                  </Button>
                </Show>
                <Show when={props.chatgptPlan}>
                  <div class="flex min-h-10 items-center gap-2 border-t border-v2-border-border-muted px-3 py-2 text-[13px] leading-5 text-v2-text-text-base">
                    <ProviderModelIcon provider={{ id: "openai", name: "OpenAI" }} class="shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.chatgptPlan")}</span>
                    <ExternalLink
                      href="https://chatgpt.com/settings/usage"
                      class="flex shrink-0 items-center gap-1 rounded-sm text-v2-text-text-muted no-underline hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2"
                    >
                      {language.t("dialog.model.chatgptManageUsage")}
                      <Icon name="arrow-up-right" size="small" />
                    </ExternalLink>
                  </div>
                </Show>
              </div>
            </div>
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </>
  )
}

function createModelSelectorController(input: {
  provider: () => string | undefined
  model?: ModelState
  onSelect: () => void
}) {
  const model = input.model ?? useLocal().model
  const [prefs] = useModelSelectorPrefs()

  const scoped = createMemo(() =>
    model.list().filter((item) => (input.provider() ? item.provider.id === input.provider() : true)),
  )

  const matchesTab = (item: ModelItem, tab: ModelTab) => {
    if (tab === "mine") return !isFreeModel(item)
    if (tab === "free") return isFreeModel(item)
    return true
  }

  return {
    all: () => scoped(),
    models: (search: string, tab: ModelTab = "mine") => {
      const query = search.trim()
      const base = scoped().filter((item) => {
        if (!matchesTab(item, tab)) return false
        // Mine/Free hide toggled-off models unless searching; All keeps them for recovery.
        if (tab !== "all" && !query && !model.visible({ modelID: item.id, providerID: item.provider.id })) return false
        return true
      })

      const filtered = query
        ? base.filter((item) =>
            matchesModelSearch(query, [item.name, item.id, item.provider.name, providerDisplay(item.provider).title]),
          )
        : base

      return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    },
    groups: (models: ModelItem[]) => {
      const byProvider = new Map<string, ModelItem[]>()

      for (const item of models) {
        byProvider.set(item.provider.id, [...(byProvider.get(item.provider.id) ?? []), item])
      }

      return Array.from(byProvider, ([category, items]) => ({ category, items })).sort(
        sortModelGroups(prefs.providerOrder),
      )
    },
    current: () => {
      const value = model.current()

      return value ? modelKey(value) : undefined
    },
    visible: (item: ModelItem) => model.visible({ modelID: item.id, providerID: item.provider.id }),
    setVisibility: (item: ModelItem, visible: boolean) => {
      model.setVisibility({ modelID: item.id, providerID: item.provider.id }, visible)
    },
    select: (item: ModelItem) => {
      model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })
      input.onSelect()
    },
  }
}

export function ModelSelectorPopoverView(props: {
  trigger: ModelSelectorTrigger
  all: () => ModelItem[]
  models: (search: string, tab?: ModelTab) => ModelItem[]
  groups: (models: ModelItem[]) => { category: string; items: ModelItem[] }[]
  current: string | undefined
  visible: (item: ModelItem) => boolean
  setVisibility: (item: ModelItem, visible: boolean) => void
  chatgptPlan?: boolean
  select: (item: ModelItem) => void
  onManage: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [prefs, setPrefs] = useModelSelectorPrefs()
  const [store, setStore] = createStore<{ open: boolean; search: string; tab: ModelTab; active: string }>({
    open: false,
    search: "",
    tab: prefs.tab,
    active: "",
  })
  let searchRef: HTMLInputElement | undefined
  let contentRef: HTMLDivElement | undefined
  const dismiss = createMenuDismissController(() => contentRef)

  const models = createMemo(() => props.models(store.search, store.tab))
  const groups = createMemo(() => props.groups(models()))
  const keys = () => [...groups().flatMap((group) => group.items.map(modelKey)), manageKey]

  const managed = createMemo(() => consoleModelGroup(props.all()))
  const managedIDs = createMemo(() => new Set(managed()?.providers.map((provider) => provider.id)))
  const canonical = (provider: ModelItem["provider"]) => provider.canonical ?? provider.id.replace(/^console-/, "")

  // The workspace badge only disambiguates a managed provider that is also connected directly.
  const direct = createMemo(
    () =>
      new Set(
        props
          .all()
          .filter((item) => !managedIDs().has(item.provider.id))
          .map((item) => canonical(item.provider)),
      ),
  )

  const initialActive = () => {
    const selected = props.current
    const options = keys()

    if (selected && options.includes(selected)) return selected

    return options[0] ?? ""
  }

  const activeItem = () =>
    store.active ? contentRef?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`) : undefined

  const setOpen = (open: boolean) => {
    if (open) {
      dismiss.allowTriggerRestore()
      const tab = resolveOpenTab({
        current: props.current,
        remembered: prefs.tab,
        models: props.models,
      })
      setStore({ open: true, search: "", tab, active: "" })
      setStore("active", initialActive())
      setTimeout(() =>
        requestAnimationFrame(() => {
          searchRef?.focus()
          activeItem()?.scrollIntoView({ block: "nearest" })
        }),
      )

      return
    }

    setStore({ open: false, search: "", active: "" })
  }

  const selectModel = (item: ModelItem) => {
    setPrefs("tab", store.tab)
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(() => props.select(item))
  }

  const manage = () => {
    dismiss.preventTriggerRestore()
    setOpen(false)
    dismiss.afterClose(props.onManage)
  }

  const selectActive = () => {
    const item = models().find((item) => modelKey(item) === store.active)

    if (item) {
      selectModel(item)

      return
    }

    if (store.active === manageKey) manage()
  }

  const moveActive = (delta: number) => {
    const options = keys()

    if (options.length === 0) return
    const index = options.indexOf(store.active)
    const start = index === -1 ? 0 : index
    setStore("active", options[(start + delta + options.length) % options.length])
    queueMicrotask(() => activeItem()?.scrollIntoView({ block: "nearest" }))
  }

  const setSearch = (value: string) => {
    const first = props.models(value, store.tab)[0]
    setStore({ search: value, active: first ? modelKey(first) : manageKey })
  }

  const setTab = (tab: ModelTab) => {
    const first = props.models(store.search, tab)[0]
    setPrefs("tab", tab)
    setStore({ tab, active: first ? modelKey(first) : manageKey })
  }

  createEffect(() => {
    if (!store.open) return
    createEventListener(
      document,
      "keydown",
      (event: KeyboardEvent) => handleDocumentSearchKeydown(searchRef, event, store.search, setSearch),
      true,
    )
  })

  return (
    <Menu open={store.open} modal={false} placement="top-start" gutter={6} onOpenChange={setOpen}>
      <Menu.Trigger as={props.trigger} />
      <Menu.Portal>
        <Menu.Content
          ref={(element: HTMLDivElement) => (contentRef = element)}
          class="w-[320px] max-w-[calc(100vw-16px)] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 !p-0 shadow-[var(--v2-elevation-floating)] focus:outline-none"
          classList={{ "!w-[340px]": props.chatgptPlan }}
          onPointerDownOutside={dismiss.preventTriggerRestore}
          onFocusOutside={dismiss.preventTriggerRestore}
          onCloseAutoFocus={dismiss.onCloseAutoFocus}
        >
          <div class="flex flex-col p-0.5">
            <div class="flex h-7 items-center gap-2 rounded-sm pl-3 pr-1 text-v2-icon-icon-muted">
              <Icon name="magnifying-glass" size="small" class="shrink-0" />
              <input
                ref={(el) => (searchRef = el)}
                value={store.search}
                placeholder={language.t("dialog.model.search.placeholder.rich")}
                class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                spellcheck={false}
                autocorrect="off"
                autocomplete="off"
                autocapitalize="off"
                onInput={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Tab") return
                  event.stopPropagation()

                  if (event.key === "Escape") {
                    event.preventDefault()
                    dismiss.preventTriggerRestore()
                    setOpen(false)
                    dismiss.afterClose(props.onClose)

                    return
                  }

                  if (event.altKey || event.metaKey) return

                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    moveActive(1)

                    return
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    moveActive(-1)

                    return
                  }

                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    selectActive()
                  }
                }}
              />
              <Show when={store.search.trim()}>
                <button
                  type="button"
                  class="flex size-5 items-center justify-center rounded-sm bg-transparent text-v2-icon-icon-faint transition-colors hover:text-v2-icon-icon-base focus-visible:text-v2-icon-icon-base active:text-v2-icon-icon-base"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => setSearch("")}
                  aria-label={language.t("common.clear")}
                >
                  <Icon name="circle-xmark" />
                </button>
              </Show>
            </div>
            <div class="px-1 pb-1 pt-0.5">
              <SegmentedControl
                class="segmented-control-v2--full-width !w-full"
                value={store.tab}
                onChange={(value) => {
                  if (value === "mine" || value === "free" || value === "all") setTab(value)
                }}
              >
                <SegmentedControlItem value="mine">{language.t("dialog.model.tab.mine")}</SegmentedControlItem>
                <SegmentedControlItem value="free">{language.t("dialog.model.tab.free")}</SegmentedControlItem>
                <SegmentedControlItem value="all">{language.t("dialog.model.tab.all")}</SegmentedControlItem>
              </SegmentedControl>
            </div>
          </div>
          <div class="h-px bg-v2-border-border-muted" />
          <ScrollView data-slot="model-selector-scroll" class="max-h-[260px] min-h-0">
            <div class="flex flex-col p-0.5 pt-0">
              <Show
                when={models().length > 0}
                fallback={
                  <div class="flex h-12 items-center px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                    {language.t("dialog.model.empty")}
                  </div>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <Menu.Group>
                      <Menu.GroupLabel
                        class="gap-1.5 pe-3"
                        style={{ "padding-inline-start": group.items[0].provider.id === "opencode" ? "10px" : "12px" }}
                      >
                        <ProviderModelIcon provider={group.items[0].provider} class="shrink-0" />
                        <Show
                          when={managedIDs().has(group.category) ? managed() : undefined}
                          fallback={
                            <span class="min-w-0 truncate">{providerDisplay(group.items[0].provider).title}</span>
                          }
                        >
                          {(workspace) => (
                            <>
                              <span class="min-w-0 truncate">
                                {consoleProviderName(workspace(), providerDisplay(group.items[0].provider).title)}
                              </span>
                              <Show when={direct().has(canonical(group.items[0].provider))}>
                                <Badge class="shrink-0">{workspace().workspace}</Badge>
                              </Show>
                            </>
                          )}
                        </Show>
                      </Menu.GroupLabel>
                      <Menu.RadioGroup value={props.current}>
                        <For each={group.items}>
                          {(item) => (
                            <div
                              class="flex w-full items-center gap-1 pe-1"
                              classList={{ "!bg-v2-overlay-simple-overlay-hover": store.active === modelKey(item) }}
                              onMouseEnter={() => {
                                setStore("active", modelKey(item))
                                setTimeout(() => searchRef?.focus())
                              }}
                            >
                              <Tooltip
                                class="min-w-0 flex-1"
                                placement="right-start"
                                gutter={6}
                                openDelay={0}
                                value={
                                  <ModelTooltip
                                    model={item}
                                    latest={item.latest}
                                    free={isFreeModel(item)}
                                    v2
                                  />
                                }
                              >
                                <Menu.RadioItem
                                  value={modelKey(item)}
                                  data-option-key={modelKey(item)}
                                  data-selected-model={props.current === modelKey(item) ? true : undefined}
                                  class="scroll-my-6 w-full !pe-1"
                                  onSelect={() => selectModel(item)}
                                >
                                  <span class="min-w-0 truncate leading-5">{item.name}</span>
                                  <Show when={isFreeModel(item)}>
                                    <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
                                  </Show>
                                  <Show when={!props.visible(item)}>
                                    <Badge class="shrink-0">{language.t("dialog.model.hidden")}</Badge>
                                  </Show>
                                  <Show when={item.latest}>
                                    <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
                                  </Show>
                                </Menu.RadioItem>
                              </Tooltip>
                              <div
                                class="shrink-0 pe-1"
                                onClick={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                              >
                                <Switch
                                  checked={props.visible(item)}
                                  onChange={(checked) => props.setVisibility(item, checked)}
                                  hideLabel
                                >
                                  {item.name}
                                </Switch>
                              </div>
                            </div>
                          )}
                        </For>
                      </Menu.RadioGroup>
                    </Menu.Group>
                  )}
                </For>
              </Show>
            </div>
          </ScrollView>
          <div class="h-px bg-v2-border-border-muted" />
          <div class="flex flex-col p-0.5">
            <Menu.Item
              data-option-key={manageKey}
              classList={{ "!bg-v2-overlay-simple-overlay-hover": store.active === manageKey }}
              onMouseEnter={() => {
                setStore("active", manageKey)
                setTimeout(() => searchRef?.focus())
              }}
              onSelect={manage}
            >
              <Icon name="outline-sliders" size="small" />
              <span class="min-w-0 flex-1 truncate leading-5">{language.t("dialog.model.manage.providers")}</span>
            </Menu.Item>
          </div>
          <Show when={props.chatgptPlan}>
            <div class="h-px bg-v2-border-border-muted" />
            <div class="flex min-h-10 items-center gap-2 px-3 py-2 text-[13px] leading-5 text-v2-text-text-base">
              <ProviderModelIcon provider={{ id: "openai", name: "OpenAI" }} class="shrink-0" />
              <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.chatgptPlan")}</span>
              <ExternalLink
                href="https://chatgpt.com/settings/usage"
                class="flex shrink-0 items-center gap-1 rounded-sm text-v2-text-text-muted no-underline hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2"
              >
                {language.t("dialog.model.chatgptManageUsage")}
                <Icon name="arrow-up-right" size="small" />
              </ExternalLink>
            </div>
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const local = useLocal()
  const directory = () => decode64(local.slug())

  const provider = () => {
    void import("@/providers/connect/dialog").then((x) => {
      void dialog.show(() => <x.DialogConnectProvider directory={directory()} />)
    })
  }

  const manage = () => {
    void import("./manage").then((x) => {
      dialog.show(() => <x.DialogManageModels />)
    })
  }

  return (
    <Dialog size="large" variant="settings">
      <DialogHeader hideClose closeLabel={language.t("common.close")}>
        <DialogTitleGroup title={language.t("dialog.model.select.title")} />
        <Button icon="plus" onClick={provider}>
          {language.t("command.provider.connect")}
        </Button>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col">
        <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
        <div class="shrink-0 border-t border-v2-border-border-muted px-4 py-3">
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] font-[530] leading-text-compact tracking-[-0.04px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
            onClick={manage}
          >
            <Icon name="outline-sliders" size="small" />
            <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.manage.providers")}</span>
          </button>
        </div>
      </DialogBody>
    </Dialog>
  )
}
