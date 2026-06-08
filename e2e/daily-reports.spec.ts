import { merchantTest as test, expect } from './fixtures';
import { waitForAppReady, selectMerchantMode } from './helpers';

test.describe('Daily reports page', () => {
  test('navigates to reports and shows header', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    // Navigate to reports via bottom nav
    await frame.getByText('Reports').click();

    await expect(
      frame.locator('[data-testid="reports-header"]'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('displays total reports count', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await frame.getByText('Reports').click();
    await expect(
      frame.locator('[data-testid="reports-header"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Reports count should be visible (may be 0 if no finalized days)
    await expect(
      frame.locator('[data-testid="reports-count"]'),
    ).toBeVisible();
  });

  test('shows empty state or report list', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await frame.getByText('Reports').click();
    await expect(
      frame.locator('[data-testid="reports-header"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Either the empty state or a report list should be present
    const reportsCount = frame.locator('[data-testid="reports-count"]');
    const countText = await reportsCount.textContent();
    const count = parseInt(countText || '0', 10);

    if (count === 0) {
      await expect(
        frame.locator('[data-testid="reports-empty"]'),
      ).toBeVisible();
    } else {
      // At least one "View Details" button should exist
      await expect(
        frame.locator('[data-testid="report-view-0"]'),
      ).toBeVisible();
    }
  });

  test('shows View On-Chain Reports link', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await frame.getByText('Reports').click();
    await expect(
      frame.locator('[data-testid="reports-header"]'),
    ).toBeVisible({ timeout: 30_000 });

    // The "View On-Chain Reports" link should be visible
    await expect(
      frame.getByText('View On-Chain Reports'),
    ).toBeVisible();
  });
});
