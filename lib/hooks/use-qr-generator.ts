import { useMemo } from "react";

export interface QRPaymentData {
  recipient: string;
  amountPlanck: string;
  /** Terminal identity from the admin config — tags the payment so the report
   *  can be attributed back to this terminal. Omitted when unbound. */
  terminalId?: string;
}

/**
 * Polkadot wallet deeplink. Scheme is `polkadotapp://`, handled by the Android
 * polkadot-app's PayDeepLinkHandler -> ExternalPayment flow. `lockAmount=true`
 * prevents the customer from editing the amount.
 *
 *   polkadotapp://pay?address=<SS58>&amount=<planks>&lockAmount=true&terminalId=<id>
 */
export function useQRGenerator(data: QRPaymentData | null) {
  return useMemo(() => {
    if (!data) return null;
    const params = new URLSearchParams({
      address: data.recipient,
      amount: data.amountPlanck,
      lockAmount: "true",
    });
    if (data.terminalId) params.set("terminalId", data.terminalId);
    return `polkadotapp://pay?${params.toString()}`;
  }, [data]);
}
