/**
 * TypeScript declarations for Ethereum provider (MetaMask, etc.)
 */

interface EthereumProvider {
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
  isMetaMask?: boolean;
  isConnected?: () => boolean;
  chainId?: string;
  selectedAddress?: string | null;
  networkVersion?: string;
}

interface Window {
  ethereum?: EthereumProvider;
}
