import { merchantTest as test, expect } from './fixtures';
import { waitForAppReady, selectMerchantMode, openReports } from './helpers';

test.describe('Daily reports page', () => {
  test('navigates to reports and shows header', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    // Reports now live under Settings → Reports & Backup → Save reports.
    await openReports(frame);

    await expect(
      frame.locator('[data-testid="reports-header"]'),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('displays the report history section', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await openReports(frame);

    // The report history section always renders (empty or populated).
    await expect(frame.getByText('Report history')).toBeVisible();
  });

  test('shows empty state or report list', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    await openReports(frame);

    // Either the empty state or at least one report row should be present.
    const empty = frame.locator('[data-testid="reports-empty"]');
    const firstReport = frame.locator('[data-testid="report-view-0"]');
    await expect(empty.or(firstReport)).toBeVisible();
  });

  test('CSV export is reachable from settings', async ({ testHost }) => {
    const frame = await waitForAppReady(testHost);
    await selectMerchantMode(frame);

    // CSV export moved out of the reports page into Settings → Export sales.
    await frame.getByText('Settings').click();
    await expect(
      frame.getByText('Export sales (CSV)'),
    ).toBeVisible({ timeout: 30_000 });
  });
});
