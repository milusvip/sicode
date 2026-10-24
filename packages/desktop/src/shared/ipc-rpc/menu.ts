import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

const DesktopMenuAction = Schema.Literals([
  "app.installCli",
  "app.relaunch",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.delete",
  "edit.selectAll",
  "view.reload",
  "view.toggleDevTools",
  "view.inspectElement",
  "view.resetZoom",
  "view.zoomIn",
  "view.zoomOut",
  "view.toggleFullscreen",
  "window.new",
  "window.close",
  "window.minimize",
  "window.toggleMaximize",
])

export const MenuRunAction = Rpc.make("MenuRunAction", {
  payload: {
    action: DesktopMenuAction,
    // Pointer position for actions that need a document coordinate, such as view.inspectElement.
    x: Schema.optionalKey(Schema.Number),
    y: Schema.optionalKey(Schema.Number),
  },
})

export const MenuRpcs = RpcGroup.make(MenuRunAction)
