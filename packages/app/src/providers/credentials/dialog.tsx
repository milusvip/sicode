import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@/shell/notifications/toast"
import { batch, For, Show } from "solid-js"
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

export function CustomProviderForm(props: {
  autofocus?: boolean
  initial?: CustomProviderInitial
  onSaved?: (providerID: string) => void
  /** When true, omit the in-form title — the surrounding DialogHeader owns it. */
  hideTitle?: boolean
} = {}) {
  const dialog = useDialog()
  const data = useData()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const editing = () => props.initial?.providerID

  const [form, setForm] = createStore<FormState>(
    props.initial ? formFromConfig(props.initial) : {
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

  const refresh = async (providerID: string) => {
    data.location.integration.invalidate()
    data.location.provider.invalidate()
    data.location.model.invalidate()
    await Promise.all([
      data.location.integration.sync(),
      data.location.provider.sync(),
      data.location.model.sync(),
    ])
    props.onSaved?.(providerID)
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      await serverSdk.api.config.update({
        providers: { [result.providerID]: result.config },
      })

      if (result.key) {
        await serverSdk.api.integration.connect.key({
          integrationID: result.providerID,
          key: result.key,
        })
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
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <Show when={!props.hideTitle}>
        <div class="px-2.5 flex gap-4 items-center">
          <CustomManagedProviderIcon class="size-5 shrink-0" />
          <div class="text-16-medium text-text-strong">
            {editing() ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")}
          </div>
        </div>
      </Show>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">
          {language.t("provider.custom.description.prefix")}
          <ExternalLink href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
            {language.t("provider.custom.description.link")}
          </ExternalLink>
          {language.t("provider.custom.description.suffix")}
        </p>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(v) => setField("providerID", v)}
            disabled={!!editing()}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(v) => setField("name", v)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
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
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
          <For each={form.models}>
            {(m, i) => (
              <div class="flex gap-2 items-start" data-row={m.row}>
                <div class="flex-1">
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
                    validationState={m.err.name ? "invalid" : undefined}
                    error={m.err.name}
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
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
            {language.t("provider.custom.models.add")}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
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
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </Button>
        </div>

        <Button
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="contrast"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
        </Button>
      </form>
    </div>
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

function DialogCustomProvider(props: {
  initial?: CustomProviderInitial
  onSaved?: (providerID: string) => void
}) {
  const language = useLanguage()
  const title = () =>
    props.initial?.providerID ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")

  return (
    <Dialog
      fit
      size="large"
      containerClass="!max-h-[min(calc(100vh_-_16px),720px)] !w-[min(calc(100vw_-_16px),560px)]"
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <div class="flex min-w-0 items-center gap-3">
          <CustomManagedProviderIcon class="size-5 shrink-0" />
          <DialogTitle>{title()}</DialogTitle>
        </div>
      </DialogHeader>
      <DialogBody class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
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

export function CustomProviderActions(props: {
  providerID: string
  name: string
  onChanged?: () => void
}) {
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
      await Promise.all([
        data.location.integration.sync(),
        data.location.provider.sync(),
        data.location.model.sync(),
      ])
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
