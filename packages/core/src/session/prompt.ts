export * as SessionPrompt from "./prompt.js"

import { Base64, FileAttachment } from "@opencode/schema/prompt"
import { PromptInput } from "@opencode/schema/prompt-input"
import { SessionInbox } from "@opencode/schema/session-inbox"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Identifier } from "@opencode/schema/identifier"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import path from "path"
import { fileURLToPath } from "url"
import { Image } from "../image.js"
import { Instance } from "../instance/service.js"
import { Mime } from "../mime.js"
import { Plugin } from "../plugin/service.js"
import { PluginHooks } from "../plugin/hooks.js"
import { Skill } from "../skill.js"
import { AttachmentError, SkillNotFoundError } from "./error.js"

/**
 * Clipboard-only paste copies live here. Files that already exist elsewhere are referenced in
 * place — never copied into this directory, never cleaned up by SiCode.
 */
export const ATTACHMENT_DIRECTORY = "attachments"

// Image types the resizer can decode; others such as HEIC and AVIF go to the provider unchanged.
const RESIZABLE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"])

export type Input = {
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  metadata?: Record<string, unknown>
  delivery?: SessionInbox.Delivery
}

export const prepare = Effect.fn("SessionPrompt.prepare")(function* (request: {
  session: Session.Info
  messageID: SessionMessage.ID
  input: Input
}) {
  const fs = yield* FSUtil.Service
  const instances = yield* Instance.Service

  return yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const hooks = yield* PluginHooks.Service
    const event = yield* hooks.trigger("session", "prompt", {
      sessionID: request.session.id,
      messageID: request.messageID,
      prompt: structuredClone({
        text: request.input.text,
        files: request.input.files?.slice(),
        agents: request.input.agents?.slice(),
        skills: request.input.skills?.slice(),
      }),
      metadata: structuredClone(request.input.metadata),
      delivery: request.input.delivery ?? "steer",
    })
    const input = event.prompt
    const files = input.files
      ? yield* Effect.forEach(input.files, (file) => materializeAttachment(file, request.session.id), {
          concurrency: 8,
        })
      : undefined
    const requested = input.skills
    const selected = yield* Effect.gen(function* () {
      if (!requested?.length) return undefined
      const skillService = yield* Skill.Service
      const prepared = new Map<Skill.ID, Skill.Name>()
      return yield* Effect.forEach(requested, (attachment) =>
        Effect.gen(function* () {
          const name = prepared.get(attachment.id)
          if (name !== undefined) return { id: attachment.id, name, mention: attachment.mention }
          const skill = yield* skillService.get(attachment.id)
          if (!skill) return yield* new SkillNotFoundError({ skill: attachment.id })
          prepared.set(skill.id, skill.name)
          return {
            id: skill.id,
            name: skill.name,
            text: (yield* Skill.prepare(fs, skill).pipe(Effect.orDie)).output,
            mention: attachment.mention,
          }
        }),
      )
    })
    return {
      type: "user",
      payload: SessionInbox.UserPayload.make({
        text: input.text,
        agents: input.agents,
        files,
        skills: selected?.length ? selected : undefined,
        metadata: event.metadata,
      }),
      delivery: event.delivery,
    } satisfies SessionInbox.Item
  }).pipe(instances.provide(request.session))
})

const materializeAttachment = Effect.fn("SessionPrompt.materializeAttachment")(function* (
  input: PromptInput.FileAttachment,
  sessionID: string,
) {
  const label = attachmentLabel(input)
  const resolved = input.uri.startsWith("data:")
    ? {
        bytes: yield* decodeDataURL(input.uri, label),
        source: { type: "inline" as const },
        start: undefined,
        end: undefined,
        name: undefined,
        mime: undefined,
      }
    : yield* readFileAttachment(input.uri)
  if (resolved.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    return yield* new AttachmentError({
      uri: label,
      message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit: ${label}`,
    })

  const mime = resolved.mime ?? Mime.detect(resolved.bytes)
  const content =
    mime === "text/plain" && resolved.start !== undefined
      ? Buffer.from(
          Buffer.from(resolved.bytes)
            .toString("utf8")
            .split("\n")
            .slice(resolved.start - 1, resolved.end)
            .join("\n"),
        )
      : resolved.bytes
  const normalized = yield* normalizeImageAttachment(input, Buffer.from(content).toString("base64"), mime)
  // SiCode attachment rule (ses_e4d917):
  //   1. File already on disk → keep that path in `name`. Never copy, never delete.
  //   2. Pure clipboard (data: with no existing path) → paste copy under data/attachments/<session>/.
  //   3. data: attachments must stay `source: inline` so the message bubble can render them
  //      (`attached()` rejects file://). Path for tools lives in `name`, not by rewriting the URI.
  if (input.uri.startsWith("data:")) {
    const existing = yield* existingAbsoluteFile(input.name)
    const absolute =
      existing ??
      (yield* persistPasteCopy({
        bytes: Buffer.from(normalized.data, "base64"),
        mime: normalized.mime,
        name: input.name,
        sessionID,
      }))
    return FileAttachment.create({
      data: normalized.data,
      mime: normalized.mime,
      source: { type: "inline" },
      name: absolute,
      description: input.description,
      mention: input.mention,
    })
  }
  const disk = fileUriPath(resolved.source.type === "uri" ? resolved.source.uri : undefined)
  return FileAttachment.create({
    data: normalized.data,
    mime: normalized.mime,
    source: resolved.source,
    name: disk ?? input.name ?? resolved.name,
    description: input.description,
    mention: input.mention,
  })
})

/** Absolute path that already exists on disk — user's file elsewhere; do not copy it. */
const existingAbsoluteFile = Effect.fn("SessionPrompt.existingAbsoluteFile")(function* (name: string | undefined) {
  if (!name) return undefined
  if (!(name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name))) return undefined
  const fs = yield* FSUtil.Service
  const info = yield* fs.stat(name).pipe(Effect.orElseSucceed(() => undefined))
  if (info?.type !== "File") return undefined
  return name
})

const fileUriPath = (uri: string | undefined) => {
  if (!uri) return undefined
  try {
    const url = new URL(uri)
    if (url.protocol !== "file:") return undefined
    url.search = ""
    url.hash = ""
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

/** Clipboard-only paste: no original path exists, so make a SiCode-owned copy for tool reads. */
const persistPasteCopy = Effect.fn("SessionPrompt.persistPasteCopy")(function* (input: {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly name: string | undefined
  readonly sessionID: string
}) {
  const fs = yield* FSUtil.Service
  const dir = path.join(Global.Path.data, ATTACHMENT_DIRECTORY, input.sessionID)
  const stem = path.basename(input.name ?? "paste", path.extname(input.name ?? ""))
  const safe = stem.replace(/[^\w.-]+/g, "_").slice(0, 64) || "paste"
  const file = path.join(dir, `${safe}_${Identifier.create(false)}${extensionFor(input.mime, input.name)}`)
  yield* fs.writeWithDirs(file, input.bytes).pipe(
    Effect.mapError(
      () =>
        new AttachmentError({
          uri: input.name ?? "inline attachment",
          message: `Unable to save attachment: ${input.name ?? "inline attachment"}`,
        }),
    ),
  )
  return file
})

const extensionFor = (mime: string, name: string | undefined) => {
  const fromName = name ? path.extname(name) : ""
  if (fromName) return fromName
  if (mime === "image/png") return ".png"
  if (mime === "image/jpeg") return ".jpg"
  if (mime === "image/gif") return ".gif"
  if (mime === "image/webp") return ".webp"
  if (mime === "image/bmp") return ".bmp"
  if (mime === "application/pdf") return ".pdf"
  if (mime === "text/plain") return ".txt"
  return ".bin"
}

const normalizeImageAttachment = Effect.fn("SessionPrompt.normalizeImageAttachment")(function* (
  input: PromptInput.FileAttachment,
  data: string,
  mime: string,
) {
  if (!RESIZABLE_IMAGE_MIMES.has(mime)) return { data: Base64.make(data), mime }
  const image = yield* Image.Service
  const label = attachmentLabel(input)
  const content = { uri: label, content: data, encoding: "base64" as const, mime }
  const normalized = yield* image.normalize(label, content).pipe(
    Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(content)),
    Effect.mapError((error) => new AttachmentError({ uri: label, message: error.message })),
  )
  return { data: Base64.make(normalized.content), mime: normalized.mime }
})

const readFileAttachment = Effect.fn("SessionPrompt.readFileAttachment")(function* (uri: string) {
  const fs = yield* FSUtil.Service
  const url = yield* Effect.try({
    try: () => new URL(uri),
    catch: () => new AttachmentError({ uri, message: `Invalid attachment URI: ${uri}` }),
  })
  if (url.protocol !== "file:")
    return yield* new AttachmentError({ uri, message: `Unsupported attachment URI: ${uri}` })
  const start = positiveInt(url.searchParams.get("start"))
  const end = positiveInt(url.searchParams.get("end"))
  const target = yield* Effect.try({
    try: () => {
      url.search = ""
      url.hash = ""
      return fileURLToPath(url)
    },
    catch: () => new AttachmentError({ uri, message: `Invalid file URI: ${uri}` }),
  })
  const info = yield* fs
    .stat(target)
    .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
  if (info.type === "Directory") {
    const entries = yield* fs
      .readDirectoryEntries(target)
      .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
    return {
      bytes: Buffer.from(
        entries
          .filter((entry) => entry.type === "file" || entry.type === "directory")
          .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1))
          .map((entry) => entry.name + (entry.type === "directory" ? path.sep : ""))
          .join("\n"),
      ),
      source: { type: "uri" as const, uri },
      start: undefined,
      end: undefined,
      name: path.basename(target),
      mime: "application/x-directory",
    }
  }
  if (info.type !== "File") return yield* new AttachmentError({ uri, message: `Attachment is not a file: ${uri}` })
  if (Number(info.size) > MAX_ATTACHMENT_BYTES)
    return yield* new AttachmentError({
      uri,
      message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit: ${uri}`,
    })
  const bytes = yield* fs
    .readFile(target)
    .pipe(Effect.mapError(() => new AttachmentError({ uri, message: `Unable to read attachment: ${uri}` })))
  return { bytes, source: { type: "uri" as const, uri }, start, end, name: path.basename(target), mime: undefined }
})

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

// A data URL is the whole file; errors and logs must name the attachment, not echo its bytes.
function attachmentLabel(input: PromptInput.FileAttachment) {
  return input.name ?? (input.uri.startsWith("data:") ? "inline attachment" : input.uri)
}

function decodeDataURL(uri: string, label: string) {
  return Effect.try({
    try: () => {
      const comma = uri.indexOf(",")
      if (comma === -1) throw new Error("Invalid data URL")
      const metadata = uri.slice(5, comma)
      const payload = uri.slice(comma + 1)
      if (!metadata.split(";").some((part) => part.toLowerCase() === "base64"))
        return Buffer.from(decodeURIComponent(payload))
      const bytes = Buffer.from(payload, "base64")
      if (bytes.toString("base64") !== payload) throw new Error("Non-canonical base64")
      return bytes
    },
    catch: () => new AttachmentError({ uri: label, message: `Invalid attachment data URL: ${label}` }),
  })
}

function positiveInt(value: string | null) {
  if (value === null) return
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
