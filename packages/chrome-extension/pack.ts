/**
 * Pack SiCode-Browser-Bridge.crx using a Chromium binary:
 *   bun run pack.ts "D:\\...\\chrome.exe"
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateKeyPairSync } from "node:crypto"

const root = path.dirname(fileURLToPath(import.meta.url))
const keyPath = path.join(root, "key.pem")
const outCrx = path.join(root, "SiCode-Browser-Bridge.crx")

const FILES = [
  "manifest.json",
  "background.js",
  "debugger-buffer.js",
  "login-dump.js",
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
]

const chrome = process.argv[2]
if (!chrome || !fs.existsSync(chrome)) {
  console.error("Usage: bun run pack.ts <path-to-chrome.exe>")
  process.exit(1)
}

if (!fs.existsSync(keyPath)) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  fs.writeFileSync(keyPath, privateKey)
  console.log("created key.pem")
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sicode-crx-"))
for (const name of FILES) {
  const from = path.join(root, name)
  if (!fs.existsSync(from)) {
    console.error("missing", name)
    process.exit(1)
  }
  const to = path.join(tmp, name)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

const packed = `${tmp}.crx`
if (fs.existsSync(packed)) fs.unlinkSync(packed)

const result = spawnSync(chrome, [`--pack-extension=${tmp}`, `--pack-extension-key=${keyPath}`], {
  encoding: "utf8",
})
if (result.status !== 0 && !fs.existsSync(packed)) {
  console.error(result.stderr || result.stdout || "pack failed")
  process.exit(1)
}
if (!fs.existsSync(packed)) {
  console.error("pack produced no .crx")
  process.exit(1)
}

fs.copyFileSync(packed, outCrx)
console.log("wrote", outCrx, fs.statSync(outCrx).size, "bytes")
