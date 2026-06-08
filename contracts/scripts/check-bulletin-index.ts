import { ethers } from "hardhat";

const BULLETIN_INDEX_ADDRESS = "0x411314dcf04C5Ab8f7058E84aF4f986EC8776DB7";
const SIGNER_ADDRESS = "0x3e065d72A6a660C97099288026F095F81bD51be7";
const DATE = "2026-02-05";

async function main() {
  console.log("Checking BulletinIndex for date:", DATE);
  console.log("Shop address:", SIGNER_ADDRESS);

  const BulletinIndex = await ethers.getContractAt(
    "T3rminalBulletinIndex",
    BULLETIN_INDEX_ADDRESS
  );

  // Check if date exists
  const exists = await BulletinIndex.dateExists(SIGNER_ADDRESS, DATE);
  console.log("Date exists:", exists);

  if (exists) {
    const metadata = await BulletinIndex.getMetadata(SIGNER_ADDRESS, DATE);
    console.log("Metadata:", {
      cidHash: metadata.cidHash,
      entryCount: metadata.entryCount.toString(),
      publishedAt: new Date(Number(metadata.publishedAt) * 1000).toISOString(),
      exists: metadata.exists,
    });

    const cid = await BulletinIndex.getCID(SIGNER_ADDRESS, DATE);
    console.log("CID hash:", cid);
  }

  // Check all dates
  const allDates = await BulletinIndex.getAllDates(SIGNER_ADDRESS);
  console.log("All dates for this shop:", allDates);

  const reportCount = await BulletinIndex.getReportCount(SIGNER_ADDRESS);
  console.log("Total reports:", reportCount.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
