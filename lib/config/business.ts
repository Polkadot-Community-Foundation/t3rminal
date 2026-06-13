/**
 * Merchant business profile shown on payment records.
 *
 * Falls back to neutral labels when no admin config is available.
 */

export interface BusinessProfile {
  name: string
  addressLine1?: string
  addressLine2?: string
  phone?: string
  /** Kept for backwards-compatible saved QR payloads. Payment records do not print tax. */
  taxRate: number
  /** Legacy fallback currency. Current payment records use the transaction asset symbol. */
  currency: string
}

export const BUSINESS_PROFILE: BusinessProfile = {
  name: "Merchant",
  taxRate: 0,
  currency: "CASH",
}

interface AdminBusinessPayload {
  displayName: string
  profile?: {
    name?: string
    addressLine1?: string
    addressLine2?: string
    phone?: string
  }
}

export function businessProfileFromAdminPayload(
  payload: AdminBusinessPayload | null | undefined,
): BusinessProfile {
  if (!payload) return BUSINESS_PROFILE

  return {
    ...BUSINESS_PROFILE,
    name: payload.profile?.name ?? payload.displayName,
    addressLine1: payload.profile?.addressLine1,
    addressLine2: payload.profile?.addressLine2,
    phone: payload.profile?.phone,
  }
}
