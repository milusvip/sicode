---
description: Upstream-owned files carry a SiCode comment
globs: packages/{core,ai,server,protocol,schema}/**/*.ts
---
- `packages/core` and `packages/ai` are upstream-owned. Any edit to a file there must carry a `// SiCode:` comment saying why, so a future upstream merge can tell our edits from theirs.
- Do not restructure upstream files to fit a local change. Add the smallest local hook and keep the upstream shape.
