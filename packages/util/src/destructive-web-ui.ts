/**
 * Guardrails for agent clicks / scripts on live web UIs.
 *
 * Soft prompts do not stop accidental "Delete" clicks on Drive / admin / billing pages.
 * Matching labels (and evaluate scripts that remove DOM or call delete APIs) are hard-blocked.
 *
 * Intentionally narrow so ordinary debug still works: Save / Submit / Login / read-only
 * evaluate that merely mentions "delete" in a selector stay allowed.
 *
 * Escape: OPENCODE_ALLOW_DESTRUCTIVE_WEB_UI=1
 */

export function destructiveWebUiAllowedByEnv() {
  return process.env.OPENCODE_ALLOW_DESTRUCTIVE_WEB_UI === "1"
}

/** Shared refusal text for tool results and injected page guards. */
export const DESTRUCTIVE_WEB_UI_BLOCKED =
  "Blocked: this control or script looks like a destructive delete/remove on the page. " +
  "SiCode will not run it by default (protects cloud files / console data). " +
  "Ask the user to confirm and click it themselves, or set OPENCODE_ALLOW_DESTRUCTIVE_WEB_UI=1 only when intentional."

/** UI chrome that looks "remove-ish" but is routine while debugging forms / tables. */
function isDebugSafeWebUiLabel(text: string) {
  const raw = text.replace(/\s+/g, " ").trim()
  if (!raw) return false
  const lower = raw.toLowerCase()

  // Clear search / filters / inputs — not wiping cloud data.
  if (/清空(搜索|筛选|过滤|輸入|输入|条件|條件)|清除(搜索|筛选|过滤|輸入|输入|条件|條件)/.test(raw)) return true
  if (/\b(clear|remove)\b.{0,20}\b(search|filter|sort|column|chip|tag|highlight)\b/.test(lower)) return true
  if (/\b(remove\s+filter|clear\s+filters?|clear\s+search|reset\s+filters?)\b/.test(lower)) return true

  // Schema / status words, not action buttons.
  if (/\b(deleted_at|is_deleted|soft_deleted|deletion_scheduled)\b/.test(lower)) return true

  return false
}

/**
 * True when accessible text / id / class / href looks like a delete-or-destroy control.
 * Structural UI signals only — not session wording.
 */
export function isDestructiveWebUiLabel(text: string) {
  const raw = text.replace(/\s+/g, " ").trim()
  if (!raw) return false
  if (isDebugSafeWebUiLabel(raw)) return false
  const lower = raw.toLowerCase()

  // Confirm / permanent wipe (ZH).
  if (
    /删除|刪除|移入回收站|永久删除|永久刪除|彻底删除|徹底刪除|确认删除|確認刪除|确定删除|確定刪除|是否删除|是否刪除|注销账号|註銷帳號|注销账户|註銷賬戶|卸载|卸載|抹掉|销毁|銷毀|恢复出厂|恢復出廠|清空回收站|清空全部|清空数据|清空數據|清空所选|清空所選|取消订阅|取消訂閱|关闭账号|關閉帳號/.test(
      raw,
    )
  ) {
    return true
  }

  // Bare 清空 without the debug-safe suffixes above.
  if (/清空/.test(raw)) return true

  // English / mixed: delete-family and account-ending actions.
  if (
    /\b(delete|destroy|uninstall|purge|wipe|erase)\b/.test(lower) ||
    /\b(remove|empty)\b.{0,24}\b(all|permanent|forever|trash|bin|account|item|file|files|row|selected)\b/.test(
      lower,
    ) ||
    /\b(permanently\s+delete|empty\s+trash|move\s+to\s+trash|confirm\s+delete|yes[,\s]+delete|are\s+you\s+sure.{0,40}delete)\b/.test(
      lower,
    ) ||
    /\b(cancel\s+subscription|close\s+account|factory\s+reset|revoke\s+(access|token|key|license)|terminate\s+account|deactivate\s+account)\b/.test(
      lower,
    )
  ) {
    return true
  }

  // Common icon-only delete affordances (class / test id).
  if (/\b(btn-delete|icon-delete|fa-trash|mdi-delete|lucide-trash|data-testid=["']?delete)\b/i.test(raw)) return true

  // URL / action hints on the same control.
  if (/([?&/]delete(?:[/=]|$)|action=delete|data-action=["']?delete)/i.test(raw)) return true

  return false
}

/**
 * Agent `browser.evaluate` scripts that clearly mutate by removing nodes or calling delete APIs.
 * Read-only probes that only mention "delete" in a selector / string stay allowed (debug).
 */
export function isDestructiveWebUiScript(script: string) {
  const text = script.replace(/\s+/g, " ").trim()
  if (!text) return false

  // DOM teardown / table row wipe.
  if (/\.remove\s*\(|removeChild\s*\(|replaceChildren\s*\(/.test(text)) return true
  if (/\b(deleteRow|deleteItem|softDelete|hardDelete)\b/i.test(text)) return true
  if (/\.destroy\s*\(|\.trash\s*\(/.test(text)) return true

  // Script that both names a delete control and fires it (click/submit), not mere querySelector.
  if (
    isDestructiveWebUiLabel(text) &&
    /\.click\s*\(|\.submit\s*\(|dispatchEvent\s*\(|form\.requestSubmit\s*\(/.test(text)
  ) {
    return true
  }

  return false
}

export function assertSafeWebUiLabel(text: string) {
  if (destructiveWebUiAllowedByEnv()) return
  if (!isDestructiveWebUiLabel(text)) return
  throw new Error(DESTRUCTIVE_WEB_UI_BLOCKED)
}

export function assertSafeWebUiScript(script: string) {
  if (destructiveWebUiAllowedByEnv()) return
  if (!isDestructiveWebUiScript(script)) return
  throw new Error(DESTRUCTIVE_WEB_UI_BLOCKED)
}
