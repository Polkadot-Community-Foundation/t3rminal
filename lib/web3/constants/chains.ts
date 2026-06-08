import { PolkadotNamespaceChainId } from "@/lib/web3/types/web3"

export const POLKADOT_APP_NAME = "T3rminal"

export const POLKADOT_CAIP_ID_MAP: Record<string, PolkadotNamespaceChainId> = {
  polkadot: "polkadot:91b171bb158e2d3848fa23a9f1c25182",
  kusama: "polkadot:b0a8d493285c2df73290dfb7e61f870f",
  westend: "polkadot:e143f23803ac50e8f6f8e62695d1ce9e",
  paseo: "polkadot:77afd6190f1554ad45fd0d31aee62aac", // Paseo testnet
}

export const POLKADOT_CHAIN_IDS = Object.values(POLKADOT_CAIP_ID_MAP)

// SS58 Format for different chains
export const SS58_FORMAT = {
  polkadot: 0,  // Polkadot addresses start with 1
  kusama: 2,    // Kusama addresses start with C-H
  westend: 42,  // Westend addresses start with 5
  paseo: 42,    // Paseo addresses start with 5 (same as Westend/generic)
  generic: 42,  // Generic Substrate addresses start with 5
}
