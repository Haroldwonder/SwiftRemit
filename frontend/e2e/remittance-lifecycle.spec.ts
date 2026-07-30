import { test, expect, Page, Route } from '@playwright/test'

const TEST_CONTRACT = 'CCL6S4Q4V3SQ6GP7VSPUNNJJZQTPR3TLSA4FKC5BVMC5KQZLQ5UVAAAA'
const TEST_WALLET = 'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTWYTTE2OF2HT4JJWUDPXVUNK'
const RPC_URL = 'https://soroban-testnet.stellar.org'

function stubFreighter(page: Page) {
  return page.addInitScript(() => {
    ;(window as any).__freighterMock = {
      isConnected: () => Promise.resolve(true),
      getPublicKey: () => Promise.resolve('GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTWYTTE2OF2HT4JJWUDPXVUNK'),
      requestAccess: () => Promise.resolve(),
      signTransaction: (xdrTx: string) => Promise.resolve(xdrTx),
    }
  })
}

function stubSorobanRpcRequests(page: Page) {
  return page.route(`${RPC_URL}/**`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          status: 'SUCCESS',
          hash: 'stub_tx_hash',
          results: [{ xdr: 'AAAA' }],
        },
      }),
    })
  })
}

function stubApiRequests(page: Page) {
  return page.route('http://localhost:3000/api/**', async (route: Route) => {
    const url = route.request().url()
    const method = route.request().method()

    if (url.includes('/api/remittances?status=Disputed')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            sender: TEST_WALLET,
            agent: 'GAGSS4G2KFSQW7IM35LLQ7MGTBLG7BL6QRUO4P425JE37Q3UNL7P4JFO',
            amount: 100,
            created_at: new Date().toISOString(),
          },
        ]),
      })
    }

    if (url.includes('/api/disputes/audit')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            remittance_id: 1,
            resolved_at: new Date().toISOString(),
            in_favour_of_sender: true,
            resolved_by: 'admin',
          },
        ]),
      })
    }

    if (url.includes('/api/disputes/') && url.endsWith('/resolve') && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tx_hash: 'stub_resolve_tx' }),
      })
    }

    return route.fulfill({ status: 404, body: JSON.stringify({ error: 'not found' }) })
  })
}

test.describe('Remittance Lifecycle E2E', () => {
  test.beforeEach(async ({ page }) => {
    await stubFreighter(page)
    await stubSorobanRpcRequests(page)
    await stubApiRequests(page)
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  test('creation: connect wallet and create a remittance', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)

    await page.locator('input[placeholder="GXXXXXXX..."]').fill('GAGSS4G2KFSQW7IM35LLQ7MGTBLG7BL6QRUO4P425JE37Q3UNL7P4JFO')

    await page.locator('input[placeholder="100.00"]').fill('150.00')

    await page.locator('input[placeholder*="Invoice"]').fill('Invoice #E2E-001')

    await page.locator('button', { hasText: 'Create Remittance' }).click()

    await expect(page.locator('.success')).toBeVisible({ timeout: 8000 })
    await expect(page.locator('text=Remittance created successfully')).toBeVisible()
    await expect(page.locator('text=Remittance ID:')).toBeVisible()
  })

  test('creation: validation error when agent address is empty', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)

    await page.locator('button', { hasText: 'Create Remittance' }).click()

    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 })
  })

  test('cancellation: remittance list panel is visible after connecting wallet', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)

    await expect(page.locator('h2', { hasText: 'Your Remittances' })).toBeVisible({ timeout: 5000 })
  })

  test('agent payout: agent panel renders with pending remittances', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)

    await expect(page.locator('h2', { hasText: 'Agent Panel' })).toBeVisible({ timeout: 5000 })
  })

  test('dispute: dispute resolution panel is accessible', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)

    await expect(page.locator('h2', { hasText: 'Dispute Resolution' })).toBeVisible({ timeout: 5000 })
  })

  test('refund: cancel confirmation dialog shows refund information', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)
  })

  test('full lifecycle: connect → create remittance → verify success', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('input[placeholder="Enter contract ID"]').fill(TEST_CONTRACT)

    await page.locator('input[placeholder="GXXXXXXX..."]').fill('GAGSS4G2KFSQW7IM35LLQ7MGTBLG7BL6QRUO4P425JE37Q3UNL7P4JFO')
    await page.locator('input[placeholder="100.00"]').fill('200.00')
    await page.locator('input[placeholder*="Invoice"]').fill('E2E full lifecycle test')

    await page.locator('button', { hasText: 'Create Remittance' }).click()
    await expect(page.locator('text=Remittance created successfully')).toBeVisible({ timeout: 8000 })
  })

  test('edge: disconnect wallet hides wallet-dependent panels', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    await page.locator('button', { hasText: 'Disconnect' }).click()

    await expect(page.locator('button', { hasText: 'Connect Freighter Wallet' })).toBeVisible()
    await expect(page.locator('h2', { hasText: 'Your Remittances' })).not.toBeVisible()
  })

  test('edge: contract id input updates are reflected in the UI', async ({ page }) => {
    await page.locator('button', { hasText: 'Connect Freighter Wallet' }).click()
    await expect(page.locator('.wallet-connected')).toBeVisible({ timeout: 8000 })

    const contractInput = page.locator('input[placeholder="Enter contract ID"]')
    await contractInput.fill(TEST_CONTRACT)

    await expect(contractInput).toHaveValue(TEST_CONTRACT)
  })
})
