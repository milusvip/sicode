import { expect, test } from "bun:test"
import { render } from "../src/config/plugin/project-map.js"

const notes = `# Investigation notes

给 agent 看的索引。

## 侧边栏浏览器

- 事实一

## 过程壳 / 时间线

- 事实二
`

test("injects the repo map and tells the model not to read it again", () => {
  const body = render("# 仓库地图\n\n| 包 | 管什么 |", undefined)
  expect(body).toContain("# Repo map")
  expect(body).toContain("| 包 | 管什么 |")
  expect(body).toContain("do not read `.sicode/structure.md` again")
})

test("lists note areas by title only, never the sections themselves", () => {
  const body = render(undefined, notes)
  expect(body).toContain("- 侧边栏浏览器")
  expect(body).toContain("- 过程壳 / 时间线")
  // The bullets under each heading are what make the full file too expensive to replay.
  expect(body).not.toContain("事实一")
  expect(body).not.toContain("事实二")
})

test("omits a section whose file is absent", () => {
  expect(render(undefined, undefined)).toBe("")
  expect(render(undefined, "# Investigation notes\n\nnothing yet")).toBe("")
  expect(render("", notes)).not.toContain("# Repo map")
})

test("keeps the map before the notes index", () => {
  const body = render("map body", notes)
  expect(body.indexOf("# Repo map")).toBeLessThan(body.indexOf("# Investigation notes"))
})
