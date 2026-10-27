import { EOL } from "node:os"
import path from "node:path"
import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

/**
 * SiCode: `sicode init` gives the project map plugin something to inject on the first run.
 *
 * `ConfigProjectMapPlugin` reads `.sicode/structure.md` on every request, but nothing created it, so
 * the map only ever existed in this repository. Claude Code solves the same problem with `/init`:
 * analyze what the repository already declares, write a skeleton, and refuse to overwrite an
 * existing file rather than guessing at a merge.
 *
 * The output is deliberately hollow. Directory responsibilities and "where does this change belong"
 * are the parts a static scan cannot know, and a wrong guess there is worse than a TODO — the model
 * trusts the map. What the scan can be sure of is which directories exist, what the scripts are
 * called, and what the readme claims the project is.
 */

const SKIP = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "venv",
  "__pycache__",
  ".venv",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".sicode",
  ".opencode",
  ".claude",
  ".agents",
])

const MAX_DIRECTORIES = 24
const MAX_SCRIPTS = 8
const SUMMARY_LIMIT = 180

const MARKERS = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ".hg"]

async function exists(target: string) {
  return stat(target).then(
    () => true,
    () => false,
  )
}

/** Walks up from `start` to the first directory that looks like a project, falling back to `start`. */
async function projectRoot(start: string) {
  let current = start
  while (true) {
    for (const marker of MARKERS) {
      if (await exists(path.join(current, marker))) return current
    }
    const parent = path.dirname(current)
    if (parent === current) return start
    current = parent
  }
}

async function directories(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_DIRECTORIES)
}

/** Reads the first paragraph of plain prose, skipping headings, badges, HTML and code fences. */
async function summary(root: string) {
  for (const name of ["README.md", "readme.md", "Readme.md", "README"]) {
    const file = Bun.file(path.join(root, name))
    if (!(await file.exists())) continue
    const line = (await file.text())
      .split("\n")
      .map((item) => item.trim())
      .find(
        (item) =>
          item.length > 0 &&
          !item.startsWith("#") &&
          !item.startsWith("[![") &&
          !item.startsWith("![") &&
          !item.startsWith("<") &&
          !item.startsWith("---") &&
          !item.startsWith(">") &&
          !item.startsWith("|") &&
          !item.startsWith("```"),
      )
    if (line) return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT)}…` : line
  }
  return undefined
}

/** The scripts worth putting in front of a model: how to build, test and check. */
async function scripts(root: string) {
  const file = Bun.file(path.join(root, "package.json"))
  if (!(await file.exists())) return []
  const parsed: unknown = await file.json().catch(() => undefined)
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) return []
  const value = parsed.scripts
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0].length > 0)
    .filter(([name]) => /^(dev|start|build|test|check|lint|typecheck)/.test(name))
    .slice(0, MAX_SCRIPTS)
}

/** The declared package name beats the directory name, which is often a temp or clone path. */
async function projectName(root: string) {
  const file = Bun.file(path.join(root, "package.json"))
  if (!(await file.exists())) return path.basename(root)
  const parsed: unknown = await file.json().catch(() => undefined)
  if (typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string" && parsed.name)
    return parsed.name
  return path.basename(root)
}

/** Files that describe how to build and run the project, for the generated `## Commands` note. */
async function manifests(root: string) {
  const candidates = ["package.json", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "Gemfile", "Makefile"]
  const present: string[] = []
  for (const name of candidates) {
    if (await exists(path.join(root, name))) present.push(name)
  }
  return present
}

async function render(root: string) {
  const [name, dirs, description, commands, files] = await Promise.all([
    projectName(root),
    directories(root),
    summary(root),
    scripts(root),
    manifests(root),
  ])

  const lines: string[] = [
    `# ${name} — 项目地图`,
    "",
    "这份文件会随每次请求注入到模型上下文里，所以只写「不写就得翻代码」的事。",
    "",
    "## 这是什么",
    "",
    description ?? "TODO: 一句话说清这个项目做什么、给谁用。",
    "",
    "## 目录",
    "",
    "| 目录 | 职责 |",
    "| --- | --- |",
    ...(dirs.length > 0 ? dirs.map((dir) => `| \`${dir}/\` | TODO |`) : ["| TODO | TODO |"]),
    "",
    "## 命令",
    "",
  ]

  lines.push(
    ...(commands.length > 0
      ? ["| 命令 | 用途 |", "| --- | --- |", ...commands.map(([script, command]) => `| \`${command}\` | ${script} |`)]
      : ["TODO: 怎么装依赖、怎么跑测试、怎么构建。"]),
  )

  lines.push(
    "",
    "## 改动该去哪",
    "",
    "- 新增功能：TODO",
    "- 修 bug 先看：TODO",
    "- 不要动：TODO",
  )

  if (files.length > 0) lines.push("", "## 清单文件", "", ...files.map((file) => `- \`${file}\``))

  return `${lines.join("\n")}\n`
}

export default Runtime.handler(
  Commands.commands.init,
  Effect.fn("cli.init")(function* () {
    const root = yield* Effect.promise(() => projectRoot(process.cwd()))
    const target = path.join(root, ".sicode", "structure.md")

    if (yield* Effect.promise(() => exists(target))) {
      process.stdout.write(`${path.relative(process.cwd(), target)} already exists, leaving it alone${EOL}`)
      return
    }

    const body = yield* Effect.promise(() => render(root))
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, body, "utf8")
    })

    process.stdout.write(`Wrote ${path.relative(process.cwd(), target)}${EOL}`)
  }),
)
