// ─── Low-XLM balance warning (Issue #949) ────────────────────────────────────
// NOTE: This module is not imported by the app entry point (src/main.jsx).
// The Freighter banner that used to live here now lives in
// src/components/FreighterBanner.tsx and is rendered by App.
// TODO(#1888): delete this file once checkXlmBalance is wired into the React app.

const LOW_XLM_THRESHOLD = 2

function showLowXlmBanner(xlmBalance: number, topUpLink: string): void {
  if (document.getElementById('low-xlm-banner')) return
  const banner = document.createElement('div')
  banner.id = 'low-xlm-banner'
  banner.setAttribute('role', 'alert')
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;padding:12px;background:#ef4444;color:#fff;text-align:center;z-index:10000;font-family:sans-serif;'
  banner.innerHTML =
    `Your XLM balance (${xlmBalance.toFixed(4)} XLM) is below ${LOW_XLM_THRESHOLD} XLM. ` +
    `Transactions may fail. ` +
    `<a href="${topUpLink}" target="_blank" rel="noopener noreferrer" style="color:#fff;font-weight:bold;text-decoration:underline;">Top up XLM</a>`
  document.body.prepend(banner)
}

export async function checkXlmBalance(stellarAddress: string): Promise<void> {
  const apiBase = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? '/api'
  try {
    const res = await fetch(`${apiBase}/accounts/${encodeURIComponent(stellarAddress)}/stellar-fees`)
    if (!res.ok) return
    const json = await res.json() as {
      success: boolean
      data: { low_balance: boolean; xlm_balance: number; top_up_link?: string }
    }
    if (json.success && json.data.low_balance) {
      const link = json.data.top_up_link ?? 'https://laboratory.stellar.org/#account-creator?network=testnet'
      showLowXlmBanner(json.data.xlm_balance, link)
    }
  } catch {
    // Non-critical — ignore network failures
  }
}
