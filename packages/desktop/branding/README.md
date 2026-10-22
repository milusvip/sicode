# SiCode 品牌资源

- `logo-source.png`：唯一的设计源文件（正方形、圆角外为纯白背景）。改 Logo 只改这一张。
- 其余图标都是派生产物，由 `script/brand/generate-icons.mjs` 生成：

```bash
bun add -d sharp png2icons
node script/brand/generate-icons.mjs packages/desktop/branding/logo-source.png .
```

生成范围：

| 目标 | 说明 |
| --- | --- |
| `packages/desktop/icons/{dev,beta,prod}/**` | 安装包 / 窗口 / Dock 图标（png + ico + icns） |
| `packages/ui/src/assets/brand/logo-mark.png` | 应用内 Mark / Splash / Wordmark 使用的位图 |
| `packages/ui/src/assets/favicon/**` | 渲染层 favicon、apple-touch-icon、manifest 图标 |
| `packages/app/public/**` | 与上面同名的公开资源（Vite 直接拷贝到产物） |

> macOS 图标额外保留 8% 内边距（Big Sur 规范），Windows 图标为满幅。
