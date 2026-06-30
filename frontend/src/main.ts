import './style.css'
import typescriptLogo from './typescript.svg'
import viteLogo from '/vite.svg'
import { setupCounter } from './counter.ts'

function showFreighterBanner(): void {
  const banner = document.createElement('div')
  banner.id = 'freighter-banner'
  banner.setAttribute('role', 'alert')
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;padding:12px;background:#f59e0b;color:#000;text-align:center;z-index:9999;font-family:sans-serif;'
  banner.innerHTML =
    'Freighter wallet extension is not installed. ' +
    '<a href="https://www.freighter.app/" target="_blank" rel="noopener noreferrer" style="font-weight:bold;text-decoration:underline;">Install Freighter</a> ' +
    'to use this application.'
  document.body.prepend(banner)
}

function isFreighterAvailable(): boolean {
  return typeof (window as Window & { freighter?: unknown }).freighter !== 'undefined'
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <a href="https://vite.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Vite + TypeScript</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite and TypeScript logos to learn more
    </p>
  </div>
`

setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)

if (!isFreighterAvailable()) {
  showFreighterBanner()
}

// ─── Low-XLM balance warning (Issue #949) ────────────────────────────────────

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
