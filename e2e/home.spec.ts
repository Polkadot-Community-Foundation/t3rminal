import { merchantTest as test, expect } from './fixtures';
import { waitForAppReady, selectMerchantMode } from './helpers';

test.describe('Home page loads via Host API', () => {
  test('shows T3RMINAL heading after host connection', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);

    await expect(
      frame.locator('[data-testid="app-heading"]'),
    ).toBeVisible();

    await expect(
      frame.locator('[data-testid="app-heading"]'),
    ).toHaveText('T3RMINAL');
  });

  test('shows continue button when wallet is connected', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);

    await expect(
      frame.locator('[data-testid="btn-merchant"]'),
    ).toBeVisible();
  });

  test('continues to merchant mode and shows bottom nav', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);

    await selectMerchantMode(frame);

    // "for Merchant" subtitle should appear
    await expect(
      frame.getByText('for Merchant'),
    ).toBeVisible({ timeout: 10_000 });

    // Bottom nav links should be visible
    await expect(frame.getByRole('link', { name: 'Payment', exact: true })).toBeVisible();
    await expect(frame.getByText('History')).toBeVisible();
    await expect(frame.getByText('Reports')).toBeVisible();
  });
});
