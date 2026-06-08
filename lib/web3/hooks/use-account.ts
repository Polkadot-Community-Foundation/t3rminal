import { useWeb3Store } from "../store/use-web3-store"

export function useAccount() {
  const account = useWeb3Store((state) => state.account)
  return { account }
}
