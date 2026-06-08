import { ethers } from "ethers";
import { activeNetwork, localNetwork } from "./config";

let providerInstance: ethers.JsonRpcProvider | null = null;

/**
 * Get or create the JSON-RPC provider
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(activeNetwork.rpcUrl);
  }
  return providerInstance;
}

/**
 * Get a signer from browser wallet (MetaMask, etc.)
 */
export async function getBrowserSigner(): Promise<ethers.Signer | null> {
  if (typeof window === "undefined") {
    console.warn("Not in browser environment");
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ethereum = (window as any).ethereum;
  if (!ethereum) {
    console.warn("No browser wallet detected");
    return null;
  }

  const provider = new ethers.BrowserProvider(ethereum);
  await provider.send("eth_requestAccounts", []);
  return provider.getSigner();
}

/**
 * Get a signer from private key (for testing)
 */
export function getPrivateKeySigner(privateKey: string): ethers.Wallet {
  const provider = getProvider();
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Get the appropriate signer based on current network
 * - For local Hardhat: uses hardcoded test account
 * - For testnet/mainnet: uses PRIVATE_KEY from environment
 */
export function getNetworkSigner(): ethers.Wallet {
  const isLocal = activeNetwork.chainId === localNetwork.chainId;

  if (isLocal) {
    // Default Hardhat account #0 private key (only for local dev)
    const HARDHAT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    return getPrivateKeySigner(HARDHAT_PRIVATE_KEY);
  }

  // For testnet/mainnet, use environment variable
  const privateKey = process.env.NEXT_PUBLIC_CONTRACT_SIGNER_KEY;
  if (!privateKey) {
    throw new Error(
      "NEXT_PUBLIC_CONTRACT_SIGNER_KEY environment variable not set. " +
      "Required for signing transactions on " + activeNetwork.name
    );
  }

  return getPrivateKeySigner(privateKey);
}

/**
 * Get the default Hardhat test account signer (account #0)
 * Only use for local development!
 * @deprecated Use getNetworkSigner() instead
 */
export function getHardhatSigner(): ethers.Wallet {
  return getNetworkSigner();
}

/**
 * Check if connected to expected network
 */
export async function isCorrectNetwork(): Promise<boolean> {
  const provider = getProvider();
  const network = await provider.getNetwork();
  return Number(network.chainId) === activeNetwork.chainId;
}

/**
 * Format date as YYYY-MM-DD for contract calls
 */
export function formatDateForContract(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

