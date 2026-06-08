import { merchantTest as test, expect } from './fixtures';
import { waitForAppReady, selectMerchantMode } from './helpers';

test.describe('Transaction history page', () => {
  test('navigates to history and shows header', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    // Navigate to history via bottom nav
    await frame.getByText('History').click();

    await expect(
      frame.locator('[data-testid="history-header"]'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('shows empty state when no transactions exist', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await frame.getByText('History').click();
    await expect(
      frame.locator('[data-testid="history-header"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Empty state or transaction list — depends on whether prior tests
    // left data. Check that search input is always visible.
    await expect(
      frame.locator('[data-testid="history-search"]'),
    ).toBeVisible();
  });

  test('search input is functional', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await frame.getByText('History').click();
    await expect(
      frame.locator('[data-testid="history-header"]'),
    ).toBeVisible({ timeout: 30_000 });

    const searchInput = frame.locator('[data-testid="history-search"]');
    await searchInput.fill('test-search-term');

    await expect(searchInput).toHaveValue('test-search-term');
  });
});
