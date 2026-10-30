# SiCode Browser Bridge

Ships as `SiCode-Browser-Bridge.crx` inside the desktop app (`electron-builder` → `resources/chrome-extension/`).

## End users

SiCode → Settings → **Browser** → turn on → **Install** → in the browser: developer mode → **Add** (same extension ID update: remove old first). No need to open this repo.

Day-to-day: **extension push** / **pick element** sticks Agent to system Chrome + page/element chips; in-app「加入对话」sticks the pane. No `@系统浏览器` / `/browser`. Pick element: popup **选元素推送** or right-click → click a node on the page (Esc cancels) → select-element chip in the current chat.

**Copy login state** (popup / right-click): dumps the page’s cookies + localStorage in the paste format for in-app **Import session** (lock icon on the built-in browser). Does not require the bridge to be connected; does not send secrets to chat.

When the desktop ships a newer CRX than the installed extension, the popup shows **先移除再安装** / remove-and-reinstall (desktop sends `packageVersion` on `hello.ok`).

## Developers — always repack after edits

Source changes (`popup.html`, `background.js`, …) do **not** update the `.crx` by themselves. Pack before Install or before desktop EXE:

```bash
bun packages/chrome-extension/pack.ts "D:\\Program Files (x86)\\baifenliulanqi\\CentBrowser\\Application\\chrome.exe"
```

`assertPackedCrxFresh` refuses Install if sources are newer than the packed CRX.

## Protocol

`ws://127.0.0.1:17891` — bridge protocol (see `protocol.js` / `gui-extensions` chrome host).
