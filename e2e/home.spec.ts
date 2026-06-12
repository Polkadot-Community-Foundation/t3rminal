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

  test('auto-redirects to the merchant home with bottom nav', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);

    // Once the host connection resolves, `/` auto-redirects to /items.
    await selectMerchantMode(frame);

    // Bottom nav links should be visible on the merchant home.
    await expect(frame.getByRole('link', { name: 'Payment', exact: true })).toBeVisible();
    await expect(frame.getByText('History')).toBeVisible();
    await expect(frame.getByText('Reports')).toBeVisible();
  });
});
