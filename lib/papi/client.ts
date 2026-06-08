import { PolkadotClient } from "polkadot-api"
import {
  getPaseoIndividualityClientAsync,
  resetClients,
} from "@/lib/host/provider"

/** Paseo Individuality — pallet-coinage host chain, where pUSD lives. */
export function getClient(): Promise<PolkadotClient> {
  return getPaseoIndividualityClientAsync()
}

export function resetClient(): void {
  resetClients()
}
