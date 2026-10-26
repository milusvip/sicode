// SiCode: 破坏性 shell 命令识别。权限配置里的 "ask" 规则在客户端开启「自动接受权限」时
// 会被 createPermissionAutoApprover 一律放行（且弹窗会被隐藏），等于形同虚设。
// 这里给出唯一判断口径：命中破坏性命令的权限请求跳过自动批准、并照常弹窗，由人来决定。
// 仅前缀匹配最外层命令；管道/脚本块内嵌的删除调用可能扫不出来（shell 解析器的已知局限）。
const DESTRUCTIVE =
  /^\s*(?:sudo\s+)?(rm|rmdir|del|erase|rd|ri|remove-item|remove-itemproperty|unlink|shred)(\s|$)/i

export function isDestructiveShell(permission: { action: string; resources: readonly string[] }) {
  return permission.action === "shell" && permission.resources.some((resource) => DESTRUCTIVE.test(resource))
}
