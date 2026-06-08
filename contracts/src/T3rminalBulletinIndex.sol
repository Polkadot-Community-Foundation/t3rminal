// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IT3rminalBulletinIndex.sol";

/**
 * @title T3rminalBulletinIndex
 * @notice Stores CID strings for daily reports published to the Bulletin Chain,
 *         scoped per (merchantId, terminalId, date). The on-chain slot key is
 *         `keccak256(abi.encode(merchantId, terminalId))`; the date is hashed
 *         to index within it. A `merchantId -> terminalId[]` index lets an
 *         admin app that knows only the merchantId enumerate every terminal and
 *         all of their reports.
 * @dev Write is permissionless. A non-finalized day's CID + metadata can be
 *      overwritten (last write wins). Calling with `finalize = true` locks the
 *      slot — any later write to the same (merchantId, terminalId, date)
 *      reverts. Trust + privacy live at the encryption layer; this contract
 *      only indexes CIDs.
 */
contract T3rminalBulletinIndex is IT3rminalBulletinIndex {
    // ========== STATE VARIABLES ==========

    /// @notice mtKey => (dateKey => metadata), where
    ///         mtKey = keccak256(abi.encode(merchantId, terminalId)),
    ///         dateKey = keccak256(bytes(date)).
    mapping(bytes32 => mapping(bytes32 => DayMetadata)) private dayMetadata;

    /// @notice mtKey => list of date strings written for that terminal.
    mapping(bytes32 => string[]) private terminalDates;

    /// @notice keccak256(bytes(merchantId)) => list of terminalIds seen.
    mapping(bytes32 => string[]) private merchantTerminals;

    /// @notice mtKey => whether the (merchant, terminal) pair was registered.
    mapping(bytes32 => bool) private terminalRegistered;

    // ========== EVENTS ==========

    event DailyReportStored(
        string merchantId,
        string terminalId,
        string date,
        string cid,
        uint256 entryCount,
        bool finalized,
        address writer
    );

    // ========== KEY HELPERS ==========

    function _mtKey(string memory merchantId, string memory terminalId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(merchantId, terminalId));
    }

    function _dateKey(string memory date) private pure returns (bytes32) {
        return keccak256(bytes(date));
    }

    // ========== CORE FUNCTIONS ==========

    /**
     * @notice Store (or overwrite) a daily report CID for a terminal + date.
     * @param merchantId Merchant identity from the terminal's config.
     * @param terminalId Terminal identity from the terminal's config.
     * @param date Date string in format "YYYY-MM-DD".
     * @param cid IPFS CID string of the (encrypted) report payload.
     * @param entryCount Number of transactions in the report.
     * @param finalize When true, locks the slot so it can never be rewritten.
     */
    function storeDailyReport(
        string memory merchantId,
        string memory terminalId,
        string memory date,
        string memory cid,
        uint256 entryCount,
        bool finalize
    ) external override {
        require(bytes(cid).length > 0, "Invalid CID");

        bytes32 mtKey = _mtKey(merchantId, terminalId);
        bytes32 dateKey = _dateKey(date);

        DayMetadata storage existing = dayMetadata[mtKey][dateKey];
        require(!existing.finalized, "day finalized");

        bool isNewDate = !existing.exists;

        dayMetadata[mtKey][dateKey] = DayMetadata({
            cid: cid,
            entryCount: entryCount,
            publishedAt: block.timestamp,
            terminalId: terminalId,
            finalized: finalize,
            exists: true
        });

        // New date for this terminal — track it for enumeration.
        if (isNewDate) {
            terminalDates[mtKey].push(date);
        }

        // First time we see this (merchant, terminal) pair — register the
        // terminal under its merchant so an admin app can discover it.
        if (!terminalRegistered[mtKey]) {
            terminalRegistered[mtKey] = true;
            merchantTerminals[keccak256(bytes(merchantId))].push(terminalId);
        }

        emit DailyReportStored(
            merchantId,
            terminalId,
            date,
            cid,
            entryCount,
            finalize,
            msg.sender
        );
    }

    // ========== VIEW FUNCTIONS ==========

    /// @notice Get CID for a specific terminal + date.
    function getCID(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view override returns (string memory) {
        return dayMetadata[_mtKey(merchantId, terminalId)][_dateKey(date)].cid;
    }

    /// @notice Get full metadata for a specific terminal + date.
    function getMetadata(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view override returns (DayMetadata memory) {
        return dayMetadata[_mtKey(merchantId, terminalId)][_dateKey(date)];
    }

    /// @notice Check whether a terminal + date slot has been written.
    function dateExists(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view override returns (bool) {
        return dayMetadata[_mtKey(merchantId, terminalId)][_dateKey(date)].exists;
    }

    /// @notice Check whether a terminal + date slot is finalized (locked).
    function isFinalized(
        string memory merchantId,
        string memory terminalId,
        string memory date
    ) external view override returns (bool) {
        return dayMetadata[_mtKey(merchantId, terminalId)][_dateKey(date)].finalized;
    }

    /// @notice Get all dates with reports for a terminal.
    function getAllDates(
        string memory merchantId,
        string memory terminalId
    ) external view override returns (string[] memory) {
        return terminalDates[_mtKey(merchantId, terminalId)];
    }

    /// @notice Get the number of reports for a terminal.
    function getReportCount(
        string memory merchantId,
        string memory terminalId
    ) external view override returns (uint256) {
        return terminalDates[_mtKey(merchantId, terminalId)].length;
    }

    /// @notice Get all terminalIds ever seen under a merchant.
    function getTerminals(
        string memory merchantId
    ) external view override returns (string[] memory) {
        return merchantTerminals[keccak256(bytes(merchantId))];
    }
}
