import { test, expect, Page } from '@playwright/test';

// Mock Freighter wallet by intercepting extension API
async function setupFreighterMock(page: Page) {
  await page.addInitScript(() => {
    (window as any).__freighterMock = {
      isConnected: () => Promise.resolve(true),
      getPublicKey: () => Promise.resolve('GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTWYTTE2OF2HT4JJWUDPXVUNK'),
      signTransaction: (xdrTx: string) => Promise.resolve(xdrTx),
    };
  });
}

test.describe('Send Money Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    await setupFreighterMock(page);
    await page.goto('/');
  });

  test('happy path: connect wallet → enter amount → select corridor → confirm', async ({ page }) => {
    // Step 1: Click connect wallet
    const connectBtn = page.locator('button:has-text("Connect Wallet")').first();
    await connectBtn.click();
    
    // Wait for wallet modal
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
    
    // Step 2: Enter amount
    const amountInput = page.locator('input[placeholder*="amount" i], input[placeholder*="send" i]').first();
    await amountInput.fill('100');
    
    // Step 3: Select corridor
    const corridorSelect = page.locator('select').first();
    await corridorSelect.selectOption('NG-USD');
    
    // Step 4: Review and confirm
    const confirmBtn = page.locator('button:has-text("Confirm")').first();
    await confirmBtn.click();
    
    // Step 5: Verify confirmation screen
    await expect(page.locator('text=Transaction Confirmed')).toBeVisible({ timeout: 10000 });
  });

  test('error state: insufficient balance', async ({ page }) => {
    // Enter large amount that exceeds balance
    const amountInput = page.locator('input[placeholder*="amount" i], input[placeholder*="send" i]').first();
    await amountInput.fill('999999');
    
    // Verify error message
    await expect(page.locator('text=Insufficient balance')).toBeVisible({ timeout: 5000 });
  });

  test('error state: rate limit hit', async ({ page }) => {
    // Simulate rate limit by making multiple rapid requests
    const amountInput = page.locator('input[placeholder*="amount" i], input[placeholder*="send" i]').first();
    
    for (let i = 0; i < 5; i++) {
      await amountInput.fill('10');
      await page.waitForTimeout(100);
    }
    
    // Verify rate limit error
    await expect(page.locator('text=Rate limit|Too many requests')).toBeVisible({ timeout: 5000 });
  });
});
