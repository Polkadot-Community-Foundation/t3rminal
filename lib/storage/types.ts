/**
 * Local Storage Types for T3RMINAL
 * Based on the three-layer storage architecture (Local -> Smart Contract -> Bulletin Chain)
 */

export type SyncStatus = 'pending' | 'synced' | 'failed';
export type TransactionType = 'incoming' | 'outgoing';

/**
 * Stored cart line — a snapshot of an item at the moment of sale, so the
 * printed/re-printed receipt is reproducible even if the catalog later
 * changes the item's name or price.
 */
export interface SaleItem {
  name: string;
  quantity: number;
  /** Per-unit price in human-readable receipt currency (e.g. "2.50"). */
  unitPrice: string;
}

/**
 * Sale record stored locally
 * This represents a completed transaction
 */
export interface SaleRecord {
  id?: number; // Auto-incremented primary key
  saleId: string; // ULID-based unique identifier
  amount: string; // Amount in human-readable format (e.g., "17.00")
  amountPlanck: string; // Amount in planck units
  asset: string; // Asset symbol (e.g., "USD", "HOLLAR")
  assetId: string; // Asset ID on chain

  // Addresses in Substrate format (prefix 42, starts with "5")
  merchantAddress: string; // Recipient address (merchant)
  customerAddress: string; // Sender address (customer)
  customerName?: string; // Optional display name (e.g., "Mason.42")

  // Normalized addresses (Substrate format, prefix 42) for indexing/querying
  merchantAddressNormalized?: string;
  customerAddressNormalized?: string;

  // Transaction details
  transactionHash?: string; // Block hash
  blockNumber?: number;
  blockHash?: string;

  // Timestamps
  timestamp: Date; // When the transaction occurred
  createdAt: Date; // When the record was created locally

  // Sync status
  syncStatus: SyncStatus;
  syncedAt?: Date;
  syncError?: string;

  /**
   * Set when the GRANDPA-finalized event for `blockHash` lands. The sale is
   * persisted on best-block (so the merchant can move on), and the watcher
   * in lib/payments/finalization-watcher.ts patches this field a few blocks
   * later. Absence means "still confirming"; presence means terminal.
   */
  finalizedAt?: Date;

  // Transaction type
  type: TransactionType;

  /** Itemized lines, when the sale came from /items. Omitted for direct-amount sales. */
  items?: SaleItem[];
}

/**
 * Pending payment waiting to be confirmed
 */
export interface PendingPayment {
  id?: number;
  saleId: string;
  amount: string;
  asset: string;
  assetId: string;
  merchantAddress: string;
  qrValue: string;
  createdAt: Date;
  expiresAt?: Date;
  status: 'waiting' | 'expired' | 'cancelled';
}

/**
 * App settings stored locally
 */
export interface AppSettings {
  id?: number;
  key: string;
  value: string;
  updatedAt: Date;
}

/**
 * Cached receipt data
 */
export interface ReceiptCache {
  id?: number;
  saleId: string;
  svgContent: string;
  pdfGenerated: boolean;
  createdAt: Date;
}

/**
 * Sync state tracking
 */
export interface SyncState {
  id?: number;
  lastSyncedBlock: number;
  lastSyncTimestamp: Date;
  syncInProgress: boolean;
}

/**
 * Daily report record stored locally
 * Replaces on-chain BulletinIndex storage
 */
export interface DailyReportRecord {
  id?: number;
  date: string; // YYYY-MM-DD
  cid: string; // IPFS CID
  gatewayUrl: string; // Full IPFS gateway URL
  bulletinBlockHash: string; // Block hash on Bulletin Chain
  entryCount: number; // Number of transactions in report
  merchantAddress: string; // Merchant who finalized
  terminalId?: string; // Terminal that produced the report
  finalized?: boolean; // Once true, the day is locked (no further overwrites)
  signedBy: string; // Who signed the Bulletin Chain transaction
  publishedAt: Date; // When the report was finalized
}
