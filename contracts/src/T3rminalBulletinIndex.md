# T3rminalBulletinIndex

On-chain index of daily report CIDs for the T3rminal merchant terminal.

Each merchant (shop) calls `storeDailyReport(date, cid, entryCount)` once per finalized day. The contract records:

- the CID of the encrypted JSON report uploaded to Bulletin Chain,
- the entry count (sale rows) committed for that day,
- the block timestamp of finalization.

Read-side accessors (`getCID`, `getMetadata`, `getAllDates`, `getReportCount`, `dateExists`) let merchant UIs and auditors reconstruct the report history for a given shop without re-uploading.

Storing is permissionless — any address can publish its own daily reports; `msg.sender` is used as the shop key, so a shop's history is naturally scoped to the address that wrote it.
