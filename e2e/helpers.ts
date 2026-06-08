import type { TestHost } from '@parity/host-api-test-sdk/playwright';
import type { FrameLocator } from '@playwright/test';

/**
 * Wait for the app to be fully ready inside the test host iframe:
 * 1. Host API connection established (product-sdk <-> host-container)
 * 2. App heading rendered (React mounted + wallet auto-connected)
 */
export async function waitForAppReady(
  testHost: TestHost,
  options?: { timeout?: number },
): Promise<FrameLocator> {
  const timeout = options?.timeout ?? 90_000;
  const frame = testHost.productFrame();

  // Wait for product-sdk to connect to host container
  await testHost.waitForConnection(timeout);

  // Wait for the T3RMINAL heading (app has mounted + host auto-connect done)
  await frame
    .locator('[data-testid="app-heading"]')
    .waitFor({ state: 'visible', timeout });

  return frame;
}

/**
 * Select merchant mode from the home page.
 * Assumes the app is on the home page with wallet connected.
 */
export async function selectMerchantMode(
  frame: FrameLocator,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30_000;
  await frame
    .locator('[data-testid="btn-merchant"]')
    .click({ timeout });
}

/**
 * Select customer mode from the home page.
 */
export async function selectCustomerMode(
  frame: FrameLocator,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30_000;
  await frame
    .locator('[data-testid="btn-customer"]')
    .click({ timeout });
}

export async function navigateToTerminal(
  frame: FrameLocator,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30_000;
  await frame.getByRole('link', { name: 'Payment', exact: true }).click({ timeout });
  await frame
    .locator('[data-testid="terminal-header"]')
    .waitFor({ state: 'visible', timeout });
}

/**
 * Enter an amount via the calculator by clicking digit buttons.
 * Supports digits 0-9 and decimal point.
 *
 * @example enterAmount(frame, '12.50')
 */
export async function enterAmount(
  frame: FrameLocator,
  amount: string,
): Promise<void> {
  for (const char of amount) {
    if (char === '.') {
      await frame.locator('[data-testid="calc-decimal"]').click();
    } else if (char >= '0' && char <= '9') {
      await frame.locator(`[data-testid="calc-digit-${char}"]`).click();
    }
  }
}
