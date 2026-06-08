// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IT3rminalBulletinIndex
 * @notice Interface for the Bulletin Index contract.
 *
 * Reports are scoped per (merchantId, terminalId, date). A merchant may run
 * many terminals; each terminal owns its own per-day slots so two terminals
 * never collide on the same date. A `merchantId -> terminalId[]` index lets an
 * admin app that knows only the merchantId enumerate every terminal and all of
 * their reports.
 *
 * Writes are permissionless (open-write); trust + privacy are enforced at the
 * encryption layer (the CID payload is encrypted to authorized recipients
 * only). A day can be finalized, after which the contract rejects any further
 * write to that (merchantId, terminalId, date) slot.
 */
interface IT3rminalBulletinIndex {
    struct DayMetadata {
        string cid;          // IPFS CID string of the encrypted report blob
        uint256 entryCount;  // number of transactions in the report
        uint256 publishedAt; // block.timestamp of the last write
        string terminalId;   // terminal that produced this report
        bool finalized;      // once true, the slot is locked
        bool exists;         // whether this slot has ever been written
    }

    function storeDailyReport(
        string memory merchantId,
        string memory terminalId,
        string memory date,
        string memory cid,
        uint256 entryCount,
        bool finalize
    ) external;

    function getCID(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view returns (string memory);

    function getMetadata(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view returns (DayMetadata memory);

    function dateExists(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view returns (bool);

    function isFinalized(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view returns (bool);

    function getAllDates(
        string memory merchantId,
        string memory terminalId
    ) external view returns (string[] memory);

    function getReportCount(
        string memory merchantId,
        string memory terminalId
    ) external view returns (uint256);

    function getTerminals(
        string memory merchantId
    ) external view returns (string[] memory);
}
