/**
 * Shorten address for display (e.g., "5GrwvaEF...92RXq")
 */
export function shortenAddress(
  address: string,
  startChars = 6,
  endChars = 4
): string {
  if (!address) return ""
  if (address.length <= startChars + endChars) return address
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`
}

/**
 * Format account name with optional address
 */
export function formatAccountName(
  name: string | undefined,
  address: string,
  showAddress = true
): string {
  if (!name) return shortenAddress(address)
  if (!showAddress) return name
  return `${name} (${shortenAddress(address)})`
}
