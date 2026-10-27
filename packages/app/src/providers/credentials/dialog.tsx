import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ScrollView } from "@opencode/ui/scroll-view"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@/shell/notifications/toast"
import { batch, For, Show, createMemo, createSignal } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useData } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import {
  formFromConfig,
  headerRow,
  isCustomProviderPackage,
  modelRow,
  type FormState,
  validateCustomProvider,
} from "./form"
import { CustomManagedProviderIcon } from "@/providers/models/provider-group"

export type CustomProviderInitial = {
  providerID: string
  config: {
    name?: string
    env?: readonly string[]
    settings?: { baseURL?: string }
    headers?: Record<string, string>
    models?: Record<string, { name?: string }>
  }
}

export function CustomProviderForm(
  props: {
    autofocus?: boolean
    initial?: CustomProviderInitial
    onSaved?: (providerID: string) => void
    /** When true, omit the in-form title — the surrounding DialogHeader owns it. */
    hideTitle?: boolean
  } = {},
) {
  const dialog = useDialog()
  const data = useData()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const editing = () => props.initial?.providerID

  const [form, setForm] = createStore<FormState>(
    props.initial
      ? formFromConfig(props.initial)
      : {
          providerID: "",
          name: "",
          baseURL: "",
          apiKey: "",
          models: [modelRow()],
          headers: [headerRow()],
          err: {},
        },
  )

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)

    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: [],
      existingProviderIDs: new Set((data.location.provider.list() ?? []).map((provider) => provider.id)),
      editingProviderID: editing(),
    })

    batch(() => {
      setForm("err", reconcile(output.err))
      output.models.forEach((err, index) => setForm("models", index, "err", reconcile(err)))
      output.headers.forEach((err, index) => setForm("headers", index, "err", reconcile(err)))
    })

    return output.result
  }

  // SiCode: ask the endpoint for its model list instead of making the user type ids from memory.
  // The probe runs on the server (the renderer cannot reach most endpoints through CORS), so this
  // just forwards what the user typed — including the headers, since some gateways auth that way.
  const [advancedOpen, setAdvancedOpen] = createSignal(
    !!props.initial?.config.headers && Object.keys(props.initial.config.headers).length > 0,
  )
  const [probe, setProbe] = createStore<{
    open: boolean
    query: string
    models: { id: string; name?: string }[]
    selected: string[]
  }>({ open: false, query: "", models: [], selected: [] })

  const probeMutation = useMutation(() => ({
    mutationFn: async () => {
      const headers = Object.fromEntries(
        form.headers.map((h) => [h.key.trim(), h.value.trim()]).filter(([key, value]) => key && value),
      )
      return serverSdk.api.provider.models({
        baseURL: form.baseURL.trim(),
        apiKey: form.apiKey.trim() || undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      })
    },
    onSuccess: (result) => {
      batch(() => {
        setProbe("open", true)
        setProbe("query", "")
        setProbe("models", result.models)
        setProbe("selected", [])
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("provider.custom.models.fetchFailed"), description: message })
    },
  }))

  const probeMatches = createMemo(() => {
    const query = probe.query.trim().toLowerCase()
    const existing = new Set(form.models.map((m) => m.id.trim()).filter(Boolean))
    return probe.models
      .map((model) => ({ ...model, added: existing.has(model.id) }))
      .filter((model) => {
        if (!query) return true
        return model.id.toLowerCase().includes(query) || (model.name ?? "").toLowerCase().includes(query)
      })
  })

  const toggleProbeModel = (id: string) => {
    setProbe("selected", (list) => (list.includes(id) ? list.filter((value) => value !== id) : [...list, id]))
  }

  const applyProbeModels = () => {
    if (probe.selected.length === 0) return

    setForm(
      "models",
      produce((rows) => {
        const last = rows[rows.length - 1]
        if (last && !last.id.trim() && !last.name.trim()) rows.pop()

        const existing = new Set(rows.map((row) => row.id.trim()))
        for (const id of probe.selected) {
          if (existing.has(id)) continue
          const source = probe.models.find((model) => model.id === id)
          rows.push({ ...modelRow(), id, name: source?.name ?? id })
        }
      }),
    )

    batch(() => {
      setProbe("open", false)
      setProbe("selected", [])
    })
  }

  const refresh = async (providerID: string) => {
    data.location.integration.invalidate()
    data.location.provider.invalidate()
    data.location.model.invalidate()
    await Promise.all([data.location.integration.sync(), data.location.provider.sync(), data.location.model.sync()])
    props.onSaved?.(providerID)
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      // SiCode: renaming an editable provider id moves the config entry and its credentials, since
      // both the config document and the credential store key off that id.
      const renamed = !!props.initial && result.providerID !== props.initial.providerID

      await serverSdk.api.config.update({
        providers: {
          [result.providerID]: result.config,
          ...(renamed ? { [props.initial!.providerID]: null } : {}),
        },
      })

      if (result.key) {
        await serverSdk.api.integration.connect.key({
          integrationID: result.providerID,
          key: result.key,
        })

        if (renamed) {
          const stale = (await serverSdk.api.credential.list()).filter(
            (credential) => credential.integrationID === props.initial!.providerID,
          )
          await Promise.all(stale.map((credential) => serverSdk.api.credential.remove({ credentialID: credential.id })))
        }
      } else if (renamed) {
        const stale = (await serverSdk.api.credential.list()).filter(
          (credential) => credential.integrationID === props.initial!.providerID,
        )
        for (const credential of stale) {
          await serverSdk.api.credential.remove({ credentialID: credential.id })
          await serverSdk.api.credential.create({
            integrationID: result.providerID,
            label: credential.label,
            value: credential.value,
            activate: credential.active,
          })
        }
      }

      await refresh(result.providerID)

      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()

    if (saveMutation.isPending) return

    const result = validate()

    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <form onSubmit={save} class="flex min-h-0 flex-1 flex-col">
      <ScrollView class="min-h-0 flex-1">
        <div class="flex flex-col gap-6 px-2.5 pb-4">
          <Show when={!props.hideTitle}>
            <div class="flex items-center gap-3 pt-1">
              <CustomManagedProviderIcon class="size-5 shrink-0" />
              <div class="text-16-medium text-text-strong">
                {editing() ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")}
              </div>
            </div>
          </Show>

          <p class="text-14-regular text-text-weak">
            {language.t("provider.custom.description.prefix")}
            <ExternalLink href="https://opencode.ai/v2/docs/providers#custom" tabIndex={-1}>
              {language.t("provider.custom.description.link")}
            </ExternalLink>
            {language.t("provider.custom.description.suffix")}
          </p>

          <section class="flex flex-col gap-4 border-t border-border-weak-base pt-5">
            <h3 class="text-12-medium text-text-weak">{language.t("provider.custom.section.connection")}</h3>
            <div class="grid grid-cols-2 gap-3">
              <TextField
                autofocus={props.autofocus ?? true}
                label={language.t("provider.custom.field.name.label")}
                placeholder={language.t("provider.custom.field.name.placeholder")}
                value={form.name}
                onChange={(v) => setField("name", v)}
                validationState={form.err.name ? "invalid" : undefined}
                error={form.err.name}
              />
              <TextField
                label={language.t("provider.custom.field.providerID.label")}
                placeholder={language.t("provider.custom.field.providerID.placeholder")}
                description={language.t("provider.custom.field.providerID.description")}
                value={form.providerID}
                onChange={(v) => setField("providerID", v)}
                validationState={form.err.providerID ? "invalid" : undefined}
                error={form.err.providerID}
              />
            </div>
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={(v) => setField("baseURL", v)}
              validationState={form.err.baseURL ? "invalid" : undefined}
              error={form.err.baseURL}
            />
            <TextField
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={
                editing()
                  ? language.t("provider.custom.field.apiKey.editDescription")
                  : language.t("provider.custom.field.apiKey.description")
              }
              value={form.apiKey}
              onChange={(v) => setField("apiKey", v)}
            />
          </section>

          <section class="flex flex-col gap-3 border-t border-border-weak-base pt-5">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</h3>
              <Button
                type="button"
                size="small"
                variant="outline"
                icon="refresh"
                disabled={!form.baseURL.trim() || probeMutation.isPending}
                onClick={() => probeMutation.mutate()}
              >
                {probeMutation.isPending
                  ? language.t("provider.custom.models.fetching")
                  : language.t("provider.custom.models.fetch")}
              </Button>
            </div>

            <For each={form.models}>
              {(m, i) => (
                <div class="flex gap-2 items-start" data-row={m.row}>
                  <div class="flex-[2]">
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setModel(i(), "id", v)}
                      validationState={m.err.id ? "invalid" : undefined}
                      error={m.err.id}
                    />
                  </div>
                  <div class="flex-1">
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setModel(i(), "name", v)}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon={<Icon name="trash" />}
                    variant="ghost"
                    class="mt-1.5"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              )}
            </For>

            <Show when={probe.open}>
              <div class="flex flex-col gap-2 rounded-[8px] border border-border-weak-base p-2.5">
                <div class="flex items-center gap-2">
                  <Icon name="magnifying-glass" class="size-4 shrink-0 text-text-weak" />
                  <input
                    type="text"
                    class="h-7 min-w-0 flex-1 bg-transparent text-14-regular text-text-base outline-none placeholder:text-text-weak"
                    placeholder={language.t("provider.custom.models.search")}
                    value={probe.query}
                    onInput={(e) => setProbe("query", e.currentTarget.value)}
                  />
                  <Button
                    type="button"
                    size="small"
                    variant="contrast"
                    disabled={probe.selected.length === 0}
                    onClick={applyProbeModels}
                  >
                    {language.t("provider.custom.models.apply", { count: probe.selected.length })}
                  </Button>
                </div>
                <ScrollView class="max-h-48">
                  <For each={probeMatches()}>
                    {(model) => (
                      <label
                        class="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-14-regular text-text-base hover:bg-v2-background-bg-layer-02"
                        classList={{ "opacity-50": model.added }}
                      >
                        <input
                          type="checkbox"
                          class="size-3.5 accent-current"
                          checked={probe.selected.includes(model.id)}
                          disabled={model.added}
                          onChange={() => toggleProbeModel(model.id)}
                        />
                        <span class="min-w-0 flex-1 truncate">{model.id}</span>
                        <Show when={model.name && model.name !== model.id}>
                          <span class="min-w-0 flex-1 truncate text-text-weak">{model.name}</span>
                        </Show>
                        <Show when={model.added}>
                          <span class="text-12-regular text-text-weak">
                            {language.t("provider.custom.models.added")}
                          </span>
                        </Show>
                      </label>
                    )}
                  </For>
                  <Show when={probeMatches.length === 0}>
                    <div class="px-2 py-3 text-center text-14-regular text-text-weak">
                      {language.t("provider.custom.models.none")}
                    </div>
                  </Show>
                </ScrollView>
              </div>
            </Show>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
              {language.t("provider.custom.models.add")}
            </Button>
          </section>

          <section class="border-t border-border-weak-base pt-5">
            <button
              type="button"
              class="flex w-full items-center gap-1.5 text-12-medium text-text-weak hover:text-text-base"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <Icon
                name="chevron-down"
                class="size-3.5 shrink-0 transition-transform"
                classList={{ "-rotate-90": !advancedOpen() }}
              />
              {language.t("provider.custom.headers.label")}
            </button>
            <Show when={advancedOpen()}>
              <div class="mt-3 flex flex-col gap-3">
                <For each={form.headers}>
                  {(h, i) => (
                    <div class="flex gap-2 items-start" data-row={h.row}>
                      <div class="flex-1">
                        <TextField
                          label={language.t("provider.custom.headers.key.label")}
                          hideLabel
                          placeholder={language.t("provider.custom.headers.key.placeholder")}
                          value={h.key}
                          onChange={(v) => setHeader(i(), "key", v)}
                          validationState={h.err.key ? "invalid" : undefined}
                          error={h.err.key}
                        />
                      </div>
                      <div class="flex-1">
                        <TextField
                          label={language.t("provider.custom.headers.value.label")}
                          hideLabel
                          placeholder={language.t("provider.custom.headers.value.placeholder")}
                          value={h.value}
                          onChange={(v) => setHeader(i(), "value", v)}
                          validationState={h.err.value ? "invalid" : undefined}
                          error={h.err.value}
                        />
                      </div>
                      <IconButton
                        type="button"
                        icon={<Icon name="trash" />}
                        variant="ghost"
                        class="mt-1.5"
                        onClick={() => removeHeader(i())}
                        disabled={form.headers.length <= 1}
                        aria-label={language.t("provider.custom.headers.remove")}
                      />
                    </div>
                  )}
                </For>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  icon="plus-small"
                  onClick={addHeader}
                  class="self-start"
                >
                  {language.t("provider.custom.headers.add")}
                </Button>
              </div>
            </Show>
          </section>
        </div>
      </ScrollView>

      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-border-weak-base px-2.5 py-3">
        <Button type="submit" size="normal" variant="contrast" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
        </Button>
      </div>
    </form>
  )
}

/** Highest-precedence global config document's custom OpenAI-compatible providers. */
export async function listCustomProviders(sdk: ReturnType<typeof useServerSDK>) {
  const entries = await sdk.api.config.get()
  const custom = new Map<string, CustomProviderInitial["config"] & { package?: string }>()

  for (const entry of entries) {
    if (entry.type !== "document") continue
    for (const [id, provider] of Object.entries(entry.info.providers ?? {})) {
      if (!isCustomProviderPackage(provider.package)) {
        custom.delete(id)

        continue
      }

      const settings = provider.settings as { baseURL?: string } | undefined
      custom.set(id, {
        name: provider.name,
        package: provider.package,
        env: provider.env,
        settings: settings?.baseURL ? { baseURL: settings.baseURL } : undefined,
        headers: provider.headers,
        models: Object.fromEntries(
          Object.entries(provider.models ?? {}).map(([modelID, model]) => [modelID, { name: model.name }]),
        ),
      })
    }
  }

  return custom
}

function DialogCustomProvider(props: { initial?: CustomProviderInitial; onSaved?: (providerID: string) => void }) {
  const language = useLanguage()
  const title = () =>
    props.initial?.providerID ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")

  return (
    <Dialog fit size="large" containerClass="!max-h-[min(calc(100vh_-_16px),720px)] !w-[min(calc(100vw_-_16px),560px)]">
      <DialogHeader closeLabel={language.t("common.close")}>
        <div class="flex min-w-0 items-center gap-3">
          <CustomManagedProviderIcon class="size-5 shrink-0" />
          <DialogTitle>{title()}</DialogTitle>
        </div>
      </DialogHeader>
      <DialogBody class="min-h-0 flex-1 overflow-hidden px-2 pb-2">
        <CustomProviderForm hideTitle initial={props.initial} onSaved={props.onSaved} />
      </DialogBody>
    </Dialog>
  )
}

export function showCustomProviderEditor(input: {
  dialog: ReturnType<typeof useDialog>
  initial?: CustomProviderInitial
  onSaved?: (providerID: string) => void
}) {
  input.dialog.show(() => <DialogCustomProvider initial={input.initial} onSaved={input.onSaved} />)
}

export function CustomProviderActions(props: { providerID: string; name: string; onChanged?: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const data = useData()

  const edit = async () => {
    const custom = await listCustomProviders(serverSdk)
    const config = custom.get(props.providerID)

    if (!config) {
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("provider.custom.unavailable"),
      })

      return
    }

    showCustomProviderEditor({
      dialog,
      initial: { providerID: props.providerID, config },
      onSaved: () => props.onChanged?.(),
    })
  }

  const remove = async () => {
    try {
      const integration = await serverSdk.api.integration.get({ integrationID: props.providerID })
      const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []
      await Promise.all(credentials.map((item) => serverSdk.api.credential.remove({ credentialID: item.id })))
      await serverSdk.api.config.update({ providers: { [props.providerID]: null } })
      data.location.integration.invalidate()
      data.location.provider.invalidate()
      data.location.model.invalidate()
      await Promise.all([data.location.integration.sync(), data.location.provider.sync(), data.location.model.sync()])
      props.onChanged?.()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.custom.deleted.title", { provider: props.name }),
        description: language.t("provider.custom.deleted.description", { provider: props.name }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  return (
    <div class="flex items-center gap-1">
      <Button size="normal" variant="ghost-muted" onClick={() => void edit()}>
        {language.t("common.edit")}
      </Button>
      <Button size="normal" variant="ghost-muted" onClick={() => void remove()}>
        {language.t("common.delete")}
      </Button>
    </div>
  )
}

export { isCustomProviderPackage }
