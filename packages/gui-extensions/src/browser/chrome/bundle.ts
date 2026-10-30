import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"

const FILES = [
  "manifest.json",
  "background.js",
  "debugger-buffer.js",
  "page.js",
  "pick-element.js",
  "popup.html",
  "popup.js",
  "protocol.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "_locales/zh_CN/messages.json",
  "_locales/en/messages.json",
] as const
const CRX_NAME = "SiCode-Browser-Bridge.crx"

/** Dev / packaged locations of the built-in MV3 extension sources. */
export function bundledExtensionSource(): string | undefined {
  const candidates: string[] = []

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "chrome-extension"))
  }

  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    candidates.push(path.join(dir, "packages", "chrome-extension"))
    candidates.push(path.join(dir, "chrome-extension"))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return candidates.find((folder) => fs.existsSync(path.join(folder, "manifest.json")))
}

/** Stable install dir under SiCode userData (not the git tree). */
export function extensionInstallDir() {
  return path.join(app.getPath("userData"), "chrome-bridge-extension")
}

export function extensionCrxPath() {
  return path.join(extensionInstallDir(), CRX_NAME)
}

/** Version stamped in the packed / materialized manifest. */
export function readExtensionPackageVersion(dir?: string) {
  const folder = dir ?? extensionInstallDir()
  try {
    const raw = fs.readFileSync(path.join(folder, "manifest.json"), "utf8")
    const value = JSON.parse(raw) as { version?: unknown }
    return typeof value.version === "string" ? value.version : ""
  } catch {
    return ""
  }
}

/**
 * Install ships the .crx only. If sources were edited after the last pack, refuse so
 * 「重新安装」cannot silently re-copy a stale CRX.
 */
export function assertPackedCrxFresh(source: string) {
  const bundledCrx = path.join(source, CRX_NAME)
  if (!fs.existsSync(bundledCrx)) {
    throw new Error(`缺少 ${CRX_NAME}，请先打包扩展。`)
  }

  const crxMtime = fs.statSync(bundledCrx).mtimeMs
  let newest = 0
  for (const name of FILES) {
    const file = path.join(source, name)
    if (!fs.existsSync(file)) continue
    const mtime = fs.statSync(file).mtimeMs
    if (mtime > newest) newest = mtime
  }

  if (newest > crxMtime + 2_000) {
    throw new Error(`扩展包已过期，请先重新打包再安装。`)
  }
}

/**
 * Copy built-in extension sources + the packed .crx into userData.
 * Product install = drag the single .crx onto chrome://extensions (developer mode).
 */
export function materializeBundledExtension(): {
  source: string
  installDir: string
  crxPath: string
  packageVersion: string
} {
  const source = bundledExtensionSource()
  if (!source) throw new Error("内置浏览器扩展未打包进应用（缺少 chrome-extension/manifest.json）。")

  assertPackedCrxFresh(source)

  const installDir = extensionInstallDir()
  fs.mkdirSync(installDir, { recursive: true })

  for (const name of FILES) {
    const from = path.join(source, name)
    if (!fs.existsSync(from)) throw new Error(`内置扩展缺少文件：${name}`)
    const to = path.join(installDir, name)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }

  const bundledCrx = path.join(source, CRX_NAME)
  const crxPath = extensionCrxPath()
  fs.copyFileSync(bundledCrx, crxPath)

  const packageVersion = readExtensionPackageVersion(source)
  fs.writeFileSync(
    path.join(installDir, ".sicode-bundled"),
    JSON.stringify({ source, crxPath, packageVersion, copiedAt: Date.now() }, null, 2),
    "utf8",
  )

  return { source, installDir, crxPath, packageVersion }
}
