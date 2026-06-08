import { expect } from "chai";
import { ethers } from "hardhat";
import { T3rminalBulletinIndex } from "../typechain-types";

describe("T3rminalBulletinIndex", function () {
  let bulletinIndex: T3rminalBulletinIndex;

  const merchant = "merchant-001";
  const terminalA = "terminal-A";
  const terminalB = "terminal-B";
  const date = "2025-01-15";
  const cid = "QmTestCid123";
  const entryCount = 10;

  beforeEach(async function () {
    const BulletinIndex = await ethers.getContractFactory("T3rminalBulletinIndex");
    bulletinIndex = await BulletinIndex.deploy();
    await bulletinIndex.waitForDeployment();
  });

  describe("storeDailyReport", function () {
    it("stores a report and reads it back", async function () {
      await expect(bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, entryCount, false))
        .to.emit(bulletinIndex, "DailyReportStored");

      expect(await bulletinIndex.getCID(merchant, terminalA, date)).to.equal(cid);
      const meta = await bulletinIndex.getMetadata(merchant, terminalA, date);
      expect(meta.cid).to.equal(cid);
      expect(meta.entryCount).to.equal(entryCount);
      expect(meta.terminalId).to.equal(terminalA);
      expect(meta.finalized).to.equal(false);
      expect(meta.exists).to.equal(true);
    });

    it("overwrites a non-finalized day (last write wins)", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, 1, false);
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, "QmNewCid", 5, false);

      expect(await bulletinIndex.getCID(merchant, terminalA, date)).to.equal("QmNewCid");
      expect(await bulletinIndex.getReportCount(merchant, terminalA)).to.equal(1);
    });

    it("rejects an empty CID", async function () {
      await expect(
        bulletinIndex.storeDailyReport(merchant, terminalA, date, "", entryCount, false)
      ).to.be.revertedWith("Invalid CID");
    });

    it("tracks dates per terminal", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, "2025-01-15", cid, 10, false);
      await bulletinIndex.storeDailyReport(merchant, terminalA, "2025-01-16", cid, 15, false);

      const dates = await bulletinIndex.getAllDates(merchant, terminalA);
      expect(dates.length).to.equal(2);
      expect(dates[0]).to.equal("2025-01-15");
      expect(dates[1]).to.equal("2025-01-16");
    });

    it("keeps terminals isolated on the same date (composite key)", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, "QmA", 10, false);
      await bulletinIndex.storeDailyReport(merchant, terminalB, date, "QmB", 20, false);

      expect(await bulletinIndex.getCID(merchant, terminalA, date)).to.equal("QmA");
      expect(await bulletinIndex.getCID(merchant, terminalB, date)).to.equal("QmB");
    });
  });

  describe("finalize lock", function () {
    it("locks a day once finalized and reports it via isFinalized", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, entryCount, true);
      expect(await bulletinIndex.isFinalized(merchant, terminalA, date)).to.equal(true);
    });

    it("reverts any further write to a finalized day", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, entryCount, true);
      await expect(
        bulletinIndex.storeDailyReport(merchant, terminalA, date, "QmOther", 99, false)
      ).to.be.revertedWith("day finalized");
    });

    it("a non-finalized save can later be finalized", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, 3, false);
      expect(await bulletinIndex.isFinalized(merchant, terminalA, date)).to.equal(false);
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, "QmFinal", 7, true);
      expect(await bulletinIndex.isFinalized(merchant, terminalA, date)).to.equal(true);
      expect(await bulletinIndex.getCID(merchant, terminalA, date)).to.equal("QmFinal");
    });
  });

  describe("merchant -> terminals index", function () {
    it("enumerates every terminal seen under a merchant", async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, 1, false);
      await bulletinIndex.storeDailyReport(merchant, terminalB, date, cid, 1, false);
      // Repeated writes for terminalA must not duplicate it in the index.
      await bulletinIndex.storeDailyReport(merchant, terminalA, "2025-01-16", cid, 1, false);

      const terminals = await bulletinIndex.getTerminals(merchant);
      expect(terminals.length).to.equal(2);
      expect([...terminals]).to.have.members([terminalA, terminalB]);
    });

    it("returns an empty list for an unknown merchant", async function () {
      const terminals = await bulletinIndex.getTerminals("nobody");
      expect(terminals.length).to.equal(0);
    });
  });

  describe("view functions", function () {
    beforeEach(async function () {
      await bulletinIndex.storeDailyReport(merchant, terminalA, date, cid, entryCount, false);
    });

    it("returns empty CID for a non-existent date", async function () {
      expect(await bulletinIndex.getCID(merchant, terminalA, "2025-01-20")).to.equal("");
    });

    it("reports dateExists correctly", async function () {
      expect(await bulletinIndex.dateExists(merchant, terminalA, date)).to.equal(true);
      expect(await bulletinIndex.dateExists(merchant, terminalA, "2025-01-20")).to.equal(false);
    });

    it("counts reports per terminal", async function () {
      expect(await bulletinIndex.getReportCount(merchant, terminalA)).to.equal(1);
      await bulletinIndex.storeDailyReport(merchant, terminalA, "2025-01-16", cid, 5, false);
      expect(await bulletinIndex.getReportCount(merchant, terminalA)).to.equal(2);
    });
  });
});
