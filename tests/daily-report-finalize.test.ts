import { describe, it, expect, beforeEach } from "vitest";
import {
  addDailyReport,
  getAllDailyReports,
  getDailyReportByDate,
  isDayFinalized,
  hasReportForDate,
  clearAllData,
} from "@/lib/storage/database";
import type { DailyReportRecord } from "@/lib/storage/types";

const base: Omit<DailyReportRecord, "id" | "date" | "cid" | "finalized"> = {
  gatewayUrl: "",
  bulletinBlockHash: "",
  entryCount: 1,
  merchantAddress: "m",
  terminalId: "term-A",
  signedBy: "",
  publishedAt: new Date(),
};

const DATE = "2025-01-15";

describe("daily report finalize lock", () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it("overwrites a non-finalized day in place (last write wins)", async () => {
    await addDailyReport({ ...base, date: DATE, cid: "QmFirst", finalized: false });
    await addDailyReport({ ...base, date: DATE, cid: "QmSecond", finalized: false });

    const reports = await getAllDailyReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].cid).toBe("QmSecond");
    expect(await isDayFinalized(DATE)).toBe(false);
  });

  it("marks the day finalized and refuses any further overwrite", async () => {
    await addDailyReport({ ...base, date: DATE, cid: "QmFinal", finalized: true });
    expect(await isDayFinalized(DATE)).toBe(true);

    await expect(
      addDailyReport({ ...base, date: DATE, cid: "QmOverwrite", finalized: false }),
    ).rejects.toThrow(/finalized/);

    // The finalized record is untouched.
    const stored = await getDailyReportByDate(DATE);
    expect(stored?.cid).toBe("QmFinal");
  });

  it("can finalize a previously-saved (draft) day", async () => {
    await addDailyReport({ ...base, date: DATE, cid: "QmDraft", finalized: false });
    await addDailyReport({ ...base, date: DATE, cid: "QmLocked", finalized: true });

    expect(await isDayFinalized(DATE)).toBe(true);
    const stored = await getDailyReportByDate(DATE);
    expect(stored?.cid).toBe("QmLocked");
  });

  it("isDayFinalized reflects the lock, hasReportForDate reflects presence", async () => {
    await addDailyReport({ ...base, date: DATE, cid: "QmDraft", finalized: false });
    expect(await hasReportForDate(DATE)).toBe(true);
    expect(await isDayFinalized(DATE)).toBe(false);
  });
});
