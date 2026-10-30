/** Stable Agent tabID for a Chrome tab — survives page reload and bridge reconnect. */
export function agentTabIDForChrome(chromeTabId: number) {
  return `tab_chrome_${chromeTabId}`
}

/** Resolve Chrome numeric id from push chips (`chrome_tab_*`) or stable Agent ids (`tab_chrome_*`). */
export function chromeIdFromTabID(tabID: string) {
  const chrome = /^chrome_tab_(\d+)$/.exec(tabID)
  if (chrome) return Number(chrome[1])
  const agent = /^tab_chrome_(\d+)$/.exec(tabID)
  if (agent) return Number(agent[1])
  return undefined
}
