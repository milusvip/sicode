import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { clipboard, dialog, shell } from "electron"
import { materializeBundledExtension } from "./bundle"

const execFileAsync = promisify(execFile)

export type DetectedBrowser = {
  id: string
  name: string
  path: string
}

export type ChromeInstallResult = {
  ok: boolean
  chromePath: string | null
  browserName: string | null
  extensionPath: string
  detected: readonly DetectedBrowser[]
  actions: readonly string[]
  message: string
}

const exists = (file: string) => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

const nameFromPath = (file: string) => {
  const lower = file.toLowerCase()
  if (lower.includes("baifenliulanqi") || lower.includes("centbrowser") || lower.includes("cent browser"))
    return "百分浏览器 (Cent Browser)"
  if (lower.includes("tabbit")) return "Tabbit Browser"
  if (lower.includes("\\google\\chrome")) return "Google Chrome"
  if (lower.includes("msedge") || lower.includes("\\microsoft\\edge")) return "Microsoft Edge"
  if (lower.includes("brave")) return "Brave"
  if (lower.includes("360chromex")) return "360 极速浏览器 X"
  if (lower.includes("360chrome")) return "360 极速浏览器"
  if (lower.includes("chromium")) return "Chromium"
  if (lower.includes("vivaldi")) return "Vivaldi"
  if (lower.includes("opera")) return "Opera"
  return path.basename(file, path.extname(file))
}

const idFor = (file: string) => file.toLowerCase()

const programRoots = () => {
  const roots = new Set<string>()
  for (const value of [
    process.env.LOCALAPPDATA,
    path.join(os.homedir(), "AppData", "Local"),
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\Program Files(x86)",
    "D:\\Program Files",
    "D:\\Program Files (x86)",
    "D:\\Program Files(x86)",
    "E:\\Program Files",
    "E:\\Program Files (x86)",
  ]) {
    if (value) roots.add(value)
  }
  return [...roots]
}

const pathCandidates = () => {
  const rel = [
    ["baifenliulanqi", "CentBrowser", "Application", "chrome.exe"],
    ["CentBrowser", "Application", "chrome.exe"],
    ["CentBrowser", "Application", "centbrowser.exe"],
    ["Tabbit Browser", "Application", "tabbit.exe"],
    ["Tabbit Browser", "Application", "chrome.exe"],
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["Microsoft", "Edge", "Application", "msedge.exe"],
    ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
    ["Chromium", "Application", "chrome.exe"],
    ["Vivaldi", "Application", "vivaldi.exe"],
    ["360Chrome", "Chrome", "Application", "360chrome.exe"],
    ["360ChromeX", "Chrome", "Application", "360chromex.exe"],
  ] as const

  return programRoots().flatMap((root) => rel.map((parts) => path.join(root, ...parts)))
}

const looksChromium = (file: string) => {
  const lower = file.toLowerCase()
  const base = path.basename(lower)
  if (base.includes("iexplore") || base.includes("firefox") || base.includes("waterfox")) return false
  if (base.includes("safari")) return false
  return (
    base === "chrome.exe" ||
    base === "msedge.exe" ||
    base === "brave.exe" ||
    base === "vivaldi.exe" ||
    base === "opera.exe" ||
    base === "centbrowser.exe" ||
    base === "tabbit.exe" ||
    base.includes("360chrome") ||
    lower.includes("centbrowser") ||
    lower.includes("baifenliulanqi") ||
    lower.includes("tabbit") ||
    lower.includes("\\chrome\\application\\") ||
    lower.includes("\\edge\\application\\")
  )
}

const shortcutTargetsViaPowerShell = async () => {
  if (process.platform !== "win32") return [] as string[]

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$roots = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
)
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -Force | ForEach-Object {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    if ($t -and (Test-Path -LiteralPath $t)) { $t }
  }
}
`
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().endsWith(".exe") && looksChromium(line) && exists(line))
  } catch {
    return []
  }
}

const shortcutTargetsViaElectron = () => {
  if (process.platform !== "win32") return [] as string[]

  const roots = [
    path.join(os.homedir(), "Desktop"),
    path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
  ].filter(Boolean)

  const targets: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !fs.existsSync(dir)) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!entry.name.toLowerCase().endsWith(".lnk")) continue
      try {
        const details = shell.readShortcutLink(full)
        if (details.target && exists(details.target) && looksChromium(details.target)) {
          targets.push(details.target)
        }
      } catch {
        // ignore
      }
    }
  }

  for (const root of roots) walk(root, 0)
  return targets
}

const registryBrowsers = async (): Promise<string[]> => {
  if (process.platform !== "win32") return []

  const keys = [
    "HKCU\\Software\\Clients\\StartMenuInternet",
    "HKLM\\Software\\Clients\\StartMenuInternet",
    "HKLM\\Software\\WOW6432Node\\Clients\\StartMenuInternet",
  ]

  const found: string[] = []
  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync("reg", ["query", key, "/s", "/ve"], {
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      })
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^\s*\(Default\)\s+REG_SZ\s+(.+\.exe.*)$/i.exec(line)
        if (!match) continue
        const raw = match[1].trim().replace(/^"|"$/g, "")
        const exe = raw
          .split(/"\s+| --|\s+--/)[0]
          ?.replace(/^"|"$/g, "")
          .trim()
        if (exe && /\.exe$/i.test(exe)) found.push(exe)
      }
    } catch {
      // key missing
    }
  }
  return found
}

export async function listChromiumBrowsers(): Promise<DetectedBrowser[]> {
  const paths = new Set<string>()
  for (const file of pathCandidates()) {
    if (exists(file)) paths.add(path.normalize(file))
  }
  for (const file of shortcutTargetsViaElectron()) {
    paths.add(path.normalize(file))
  }
  for (const file of await shortcutTargetsViaPowerShell()) {
    paths.add(path.normalize(file))
  }
  for (const file of await registryBrowsers()) {
    const normalized = path.normalize(file)
    if (exists(normalized) && looksChromium(normalized)) paths.add(normalized)
  }

  return [...paths]
    .map((file) => ({
      id: idFor(file),
      name: nameFromPath(file),
      path: file,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"))
}

export async function pickChromiumBrowser(): Promise<DetectedBrowser | null> {
  const result = await dialog.showOpenDialog({
    title: "选择浏览器程序（chrome.exe）",
    defaultPath: "D:\\Program Files (x86)\\baifenliulanqi\\CentBrowser\\Application",
    properties: ["openFile"],
    filters: [{ name: "Browser", extensions: ["exe"] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const file = path.normalize(result.filePaths[0])
  if (!exists(file)) return null
  return { id: idFor(file), name: nameFromPath(file), path: file }
}

const runDetached = (command: string, args: string[]) => {
  spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false }).unref()
}

/**
 * Open chrome://extensions (so the user can remove a stale install) then the .crx
 * so Chromium shows the native「添加扩展程序？」dialog.
 * One process + `--new-tab`: reuse the already-running browser window (do not spawn a second window).
 */
const launchCrxInstall = (browserPath: string, crxPath: string) => {
  runDetached(browserPath, ["--new-tab", "chrome://extensions/", crxPath])
}

/** Launch Chromium so a sleeping MV3 service worker can reconnect to the bridge. */
export async function wakeChromiumBrowser(browserPath?: string | null): Promise<{
  ok: boolean
  chromePath: string | null
  browserName: string | null
  message: string
}> {
  const detected = await listChromiumBrowsers()
  const selected =
    (browserPath &&
      (detected.find((item) => item.path === browserPath || item.id === browserPath.toLowerCase()) ??
        (exists(browserPath)
          ? {
              id: idFor(browserPath),
              name: nameFromPath(browserPath),
              path: path.normalize(browserPath),
            }
          : null))) ||
    detected[0] ||
    null

  if (!selected) {
    return { ok: false, chromePath: null, browserName: null, message: "No Chromium browser found" }
  }

  try {
    // about:blank wakes the browser (and usually the extension SW) without an install dialog.
    // Prefer a new tab in the existing window when the browser is already open.
    runDetached(selected.path, ["--new-tab", "about:blank"])
    return { ok: true, chromePath: selected.path, browserName: selected.name, message: "ok" }
  } catch (error) {
    return {
      ok: false,
      chromePath: selected.path,
      browserName: selected.name,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function openChromeExtensionInstall(
  _extensionPath: string,
  browserPath?: string | null,
): Promise<ChromeInstallResult> {
  const actions: string[] = []
  let detected = await listChromiumBrowsers()

  let crxPath: string
  let packageVersion = ""
  try {
    const released = materializeBundledExtension()
    crxPath = released.crxPath
    packageVersion = released.packageVersion
    actions.push("materialize")
  } catch (error) {
    return {
      ok: false,
      chromePath: null,
      browserName: null,
      extensionPath: _extensionPath,
      detected,
      actions,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    clipboard.writeText(crxPath)
    actions.push("clipboard-crx")
  } catch {
    // optional
  }

  let selected =
    (browserPath &&
      (detected.find((item) => item.path === browserPath || item.id === browserPath.toLowerCase()) ??
        (exists(browserPath)
          ? {
              id: idFor(browserPath),
              name: nameFromPath(browserPath),
              path: path.normalize(browserPath),
            }
          : null))) ||
    null

  if (!selected) {
    if (detected.length >= 1) selected = detected[0]!
    else {
      const picked = await pickChromiumBrowser()
      if (picked) {
        selected = picked
        detected = [picked]
      }
    }
  }

  if (!selected) {
    return {
      ok: false,
      chromePath: null,
      browserName: null,
      extensionPath: crxPath,
      detected,
      actions,
      message: `请先选择浏览器。\n${crxPath}`,
    }
  }

  try {
    launchCrxInstall(selected.path, crxPath)
    actions.push("browser")
  } catch (error) {
    return {
      ok: false,
      chromePath: selected.path,
      browserName: selected.name,
      extensionPath: crxPath,
      detected,
      actions,
      message: `打不开「${selected.name}」：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return {
    ok: true,
    chromePath: selected.path,
    browserName: selected.name,
    extensionPath: crxPath,
    detected,
    actions,
    message: `v${packageVersion || "?"} 已就绪。先删旧扩展，再点「添加」。`,
  }
}
