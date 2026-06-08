import { isValidSubstrateAddress } from "./address"

export function validateAddress(address: string): {
  isValid: boolean
  error?: string
} {
  if (!address) {
    return { isValid: false, error: "Address is required" }
  }

  if (!isValidSubstrateAddress(address)) {
    return { isValid: false, error: "Invalid Substrate address" }
  }

  return { isValid: true }
}
