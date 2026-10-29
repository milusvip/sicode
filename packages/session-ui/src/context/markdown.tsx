import { createContext, useContext, type ParentProps } from "solid-js"

export type ReadMarkdownImage = (path: string, signal: AbortSignal) => Promise<Blob | undefined>

/** Open a local file path linked from markdown. The path is decoded and may be relative or absolute. */
export type OpenMarkdownLocalFile = (path: string) => void

/**
 * Open an external http(s)/mailto link. The host owns the destination — the desktop shell sends it to
 * the system browser, a future preference could send it to the side browser pane — so markdown never
 * assumes the embedder's `target="_blank"` handling is the right one.
 */
export type OpenMarkdownExternalLink = (url: string) => void

/**
 * Whether an inline-code path names a file that exists. Inline code is styled as a file link only when this says yes;
 * without it, inline code stays plain.
 */
export type MarkdownLocalFileExists = (path: string) => boolean | Promise<boolean>

const context = createContext<{
  readonly readImage?: ReadMarkdownImage
  readonly openLocalFile?: OpenMarkdownLocalFile
  readonly openExternal?: OpenMarkdownExternalLink
  readonly localFileExists?: MarkdownLocalFileExists
  readonly openSession?: (sessionID: string) => void
}>()

export function MarkdownProvider(
  props: ParentProps<{
    readImage?: ReadMarkdownImage
    openLocalFile?: OpenMarkdownLocalFile
    openExternal?: OpenMarkdownExternalLink
    localFileExists?: MarkdownLocalFileExists
    openSession?: (id: string) => void
  }>,
) {
  const parent = useMarkdown()

  return (
    <context.Provider
      value={{
        get readImage() {
          return props.readImage
        },
        get openLocalFile() {
          return props.openLocalFile
        },
        get openExternal() {
          return props.openExternal ?? parent?.openExternal
        },
        get localFileExists() {
          return props.localFileExists ?? parent?.localFileExists
        },
        get openSession() {
          return props.openSession ?? parent?.openSession
        },
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export const useMarkdown = () => useContext(context)
