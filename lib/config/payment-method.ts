/**
 * Payment-method selector.
 *
 * T3rminal can take payments two ways, and the merchant flips between them in
 * Settings:
 *
 * - `standard`: the pUSD-on-Asset-Hub flow. The terminal shows a QR
 *   carrying `{ recipient, amountPlanck }`; the customer's wallet submits an
 *   `Assets.transfer` and `usePaymentListener` watches the chain for it.
 *
 * - `coins` (default): the W3S real-time Coinage flow (Merchant Payments "Host &
 *   Terminal"). The terminal mints a fresh ephemeral P256 keypair + payment
 *   id, shows a `polkadotapp://w3spay.dot/pay-w3s` deeplink QR, listens on the
 *   derived statement-store topic, then decrypts the incoming bearer coins and
 *   claims them into the merchant's own coin set via the host's
 *   `paymentTopUp(Coins)` (Android PR #676 / host-api ≥ 0.8.3, exposed through
 *   the `@novasamatech/host-api-wrapper` `coins` top-up source).
 *
 * The two flows are mutually exclusive at the terminal — only the active one
 * generates a QR and arms a listener.
 */

"use client";

import { getSetting, setSetting } from "@/lib/storage/database";
import { onStorageChange } from "@/lib/storage/host-storage";
import { useEffect, useState } from "react";

export type PaymentMethod = "standard" | "coins";

export const PAYMENT_METHOD_SETTING = "terminal/payment-method";

export const DEFAULT_PAYMENT_METHOD: PaymentMethod = "coins";

function parsePaymentMethod(raw: string | undefined): PaymentMethod {
  return raw === "standard" ? "standard" : DEFAULT_PAYMENT_METHOD;
}

export async function getPaymentMethod(): Promise<PaymentMethod> {
  return parsePaymentMethod(await getSetting(PAYMENT_METHOD_SETTING));
}

export async function setPaymentMethod(method: PaymentMethod): Promise<void> {
  await setSetting(PAYMENT_METHOD_SETTING, method);
}

/**
 * Reactive hook — flips whenever the setting changes from any tab/page.
 * Returns `undefined` until the first read resolves so the UI can show a
 * loading state instead of flashing the default.
 */
export function usePaymentMethod(): {
  method: PaymentMethod | undefined;
  setMethod: (next: PaymentMethod) => Promise<void>;
} {
  const [method, setMethod] = useState<PaymentMethod | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getPaymentMethod().then((v) => {
        if (alive) setMethod(v);
      });
    };
    refresh();
    const off = onStorageChange("settings", refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return {
    method,
    setMethod: async (next: PaymentMethod) => {
      await setPaymentMethod(next);
      setMethod(next);
    },
  };
}
