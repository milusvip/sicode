#!/usr/bin/env node
// Regenerates every SiCode brand asset from one square source image.
//
//   bun add -d sharp png2icons
//   node script/brand/generate-icons.mjs [source.png] [repoRoot]
//
// The source image must be a square app icon whose surroundings are pure white; the script crops to
// the icon plate, masks its rounded corners and derives ico/icns/png/favicon variants from it.
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import png2icons from "png2icons"

const ROOT = path.resolve(process.argv[3] ?? ".")
const SRC = path.resolve(process.argv[2] ?? path.join(ROOT, "packages/desktop/branding/logo-source.png"))

const WHITE = 246 // luminance above which a pixel counts as background
const MAC_PADDING = 0.08 // Big Sur style icons keep a small margin around the plate

async function loadPlate() {
  const { data, info } = await sharp(SRC).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  })
  const { width, height, channels } = info
  const lum = (x, y) => {
    const i = (y * width + x) * channels
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (lum(x, y) >= WHITE) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) throw new Error(`No icon plate found in ${SRC}`)

  // The plate's top row only starts after the corner radius, so the first opaque pixel is the radius.
  let radius = 0
  for (let x = minX; x <= maxX; x += 1) {
    if (lum(x, minY + 1) < WHITE) {
      radius = x - minX
      break
    }
  }

  return { minX, minY, size: Math.max(maxX - minX + 1, maxY - minY + 1), radius }
}

const plate = await loadPlate()

const roundedMask = (size, radius) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  )

async function master(size, padding) {
  const inner = Math.round(size * (1 - padding * 2))
  const scaled = await sharp(SRC)
    .flatten({ background: "#ffffff" })
    .extract({ left: plate.minX, top: plate.minY, width: plate.size, height: plate.size })
    .resize(inner, inner, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer()
  const masked = await sharp(scaled)
    .composite([{ input: roundedMask(inner, Math.round((plate.radius / plate.size) * inner * 0.92)), blend: "dest-in" }])
    .png()
    .toBuffer()

  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: masked, top: Math.round(size * padding), left: Math.round(size * padding) }])
    .png()
    .toBuffer()
}

async function writePng(buffer, file, size) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    await sharp(buffer).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer(),
  )
}

const full = await master(1024, 0)
const mac = await master(1024, MAC_PADDING)
const ico = png2icons.createICO(await sharp(full).resize(256, 256).png().toBuffer(), png2icons.BICUBIC, 0, true)
const icns = png2icons.createICNS(mac, png2icons.BICUBIC, 0)
if (!ico || !icns) throw new Error("png2icons failed to encode the icon")

const desktop = path.join(ROOT, "packages/desktop/icons")
const named = {
  "32x32.png": 32,
  "64x64.png": 64,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "Square30x30Logo.png": 30,
  "Square44x44Logo.png": 44,
  "Square71x71Logo.png": 71,
  "Square89x89Logo.png": 89,
  "Square107x107Logo.png": 107,
  "Square142x142Logo.png": 142,
  "Square150x150Logo.png": 150,
  "Square284x284Logo.png": 284,
  "Square310x310Logo.png": 310,
  "StoreLogo.png": 50,
  "icon.png": 512,
}

for (const channel of ["dev", "beta", "prod"]) {
  const dir = path.join(desktop, channel)
  for (const [name, size] of Object.entries(named)) await writePng(full, path.join(dir, name), size)
  await writePng(mac, path.join(dir, "dock.png"), 256)
  await fs.writeFile(path.join(dir, "icon.ico"), ico)
  await fs.writeFile(path.join(dir, "icon.icns"), icns)

  // Mobile sizes left over from the Tauri era stay in sync at their original dimensions.
  for (const sub of ["android", "ios"]) {
    let entries = []
    try {
      entries = await fs.readdir(path.join(dir, sub), { recursive: true, withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".png")) continue
      const file = path.join(entry.parentPath ?? entry.path, entry.name)
      const meta = await sharp(file).metadata()
      if (meta.width) await writePng(full, file, meta.width)
    }
  }
}

const faviconIco = png2icons.createICO(await sharp(full).resize(64, 64).png().toBuffer(), png2icons.BICUBIC, 0, true)
if (!faviconIco) throw new Error("png2icons failed to encode the favicon")

const faviconSvg = async (size) => {
  const png = await sharp(full).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${png.toString("base64")}"/></svg>\n`
}

for (const dir of [path.join(ROOT, "packages/ui/src/assets/favicon"), path.join(ROOT, "packages/app/public")]) {
  await fs.mkdir(dir, { recursive: true })
  for (const name of ["favicon-96x96.png", "favicon-96x96-v3.png"]) await writePng(full, path.join(dir, name), 96)
  for (const name of ["apple-touch-icon.png", "apple-touch-icon-v3.png"]) await writePng(full, path.join(dir, name), 180)
  await writePng(full, path.join(dir, "web-app-manifest-192x192.png"), 192)
  await writePng(full, path.join(dir, "web-app-manifest-512x512.png"), 512)
  for (const name of ["favicon.ico", "favicon-v3.ico"]) await fs.writeFile(path.join(dir, name), faviconIco)
  for (const name of ["favicon.svg", "favicon-v3.svg"]) await fs.writeFile(path.join(dir, name), await faviconSvg(512))
}

const brand = path.join(ROOT, "packages/ui/src/assets/brand")
await writePng(full, path.join(brand, "logo-mark.png"), 256)
await writePng(mac, path.join(brand, "logo-mark-mac.png"), 256)

console.log(`SiCode icons generated from ${SRC}`)
