"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Loader2, Check, Download, Delete, Share2, Grid3X3 } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { useAccount } from "@/lib/web3";
import { QRCodeSVG } from "qrcode.react";
import { useQRGenerator } from "@/lib/hooks/use-qr-generator";
import { usePaymentListener, type PaymentDetected } from "@/lib/hooks/use-payment-listener";
import { useReceiptGenerator } from "@/lib/hooks/use-receipt-generator";
import { useCalculator, type CalculatorOperator } from "@/lib/hooks/use-calculator";
import { PUSD_ASSET_ID, PUSD_DECIMALS } from "@/lib/utils/asset-ids";
import { useAssetSymbol, getAssetSymbol } from "@/lib/utils/asset-metadata";
import { formatAmountFromPlanck, amountToPlanck } from "@/lib/utils/format";
import { useAddSale } from "@/lib/storage";
import { normalizeToAssetHubAddress } from "@/lib/utils/address";
import {
  clearPendingSale,
  readPendingSale,
  type StoredCartLine,
} from "@/lib/items/pending-sale";
import type { ReceiptItem } from "@/lib/receipts/receipt-generator";
import { journeyTracker, captureError, recordPaymentOutcome } from "@/lib/telemetry";
import { useAdminQrPayload } from "@/lib/config/admin-qr";
import { watchForFinalization } from "@/lib/payments/finalization-watcher";
import { usePaymentMethod } from "@/lib/config/payment-method";
import {
  useCoinagePayment,
  type CoinagePaymentResult,
} from "@/lib/payments/coinage";

const OPERATORS: CalculatorOperator[] = ["+", "-", "×", "÷"];
const ASSET_ID_STR = PUSD_ASSET_ID.toString();

type TerminalState = "input" | "qr" | "completed" | "receipt" | "share";
  
export default function TerminalPage() {
  return (
    <Suspense fallback={null}>
      <TerminalPageInner />
    </Suspense>
  );
}

function TerminalPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account } = useAccount();
  const adminPayload = useAdminQrPayload();
  // When the merchant has scanned an admin QR, payments are routed to the
  // configured payout address regardless of which wallet is connected.
  // Falls back to the connected account so direct-amount flows still work
  // before an admin binding exists.
  const receivingAddress = adminPayload?.receivingAddress ?? account?.address;
  const { generateSvgReceipt, buildReceiptQrValue, downloadPdfReceipt } = useReceiptGenerator();
  const { addSale } = useAddSale();
  const calculator = useCalculator();
  // Payment method (Settings → Payment Method). `coins` swaps the QR + the
  // detection mechanism over to the W3S real-time Coinage flow.
  const { method } = usePaymentMethod();
  const useCoins = method === "coins";
  // Token symbol pulled from on-chain asset metadata (falls back to the
  // bundled default until the chain read resolves).
  const symbol = useAssetSymbol();
  const [terminalState, setTerminalState] = useState<TerminalState>("input");
  const [isGenerating, setIsGenerating] = useState(false);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [paymentReceived, setPaymentReceived] = useState<PaymentDetected | null>(null);
  const [svgReceipt, setSvgReceipt] = useState<string | null>(null);
  const [finalAmount, setFinalAmount] = useState<string>("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  // Cart lines stashed by /items "Charge" — flow into the printed receipt.
  const [pendingItems, setPendingItems] = useState<StoredCartLine[]>([]);

  // Preset amount from /items "Charge" flow: ?amount=<plancks>&source=items
  // skips the keypad and jumps straight to the QR screen with that total,
  // and pulls the itemized cart out of sessionStorage so the receipt can
  // render line-by-line later.
  useEffect(() => {
    const amountParam = searchParams.get("amount");
    if (!amountParam || !/^\d+$/.test(amountParam)) return;
    const decimal = formatAmountFromPlanck(amountParam, PUSD_DECIMALS);
    setFinalAmount(decimal);
    setTerminalState("qr");

    if (searchParams.get("source") === "items") {
      const pending = readPendingSale();
      if (pending) {
        setPendingItems(pending.lines);
      }
    }

    // Journey starts here — first frame the merchant sees the QR. We measure
    // until the success screen renders (or fail/abandon). Admin identifiers
    // (when bound) are also attached so Sentry traces can be filtered per
    // merchant/terminal.
    if (!journeyTracker.isActive("terminal-payment")) {
      journeyTracker.start("terminal-payment", {
        "journey.amount": decimal,
        "journey.source": searchParams.get("source") ?? "direct",
        "journey.terminal_id": adminPayload?.terminalId ?? "unbound",
        "journey.merchant_id": adminPayload?.merchantId ?? "unbound",
      });
    }
    // run once on mount with whatever the URL says
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qrData = finalAmount && receivingAddress ? {
    recipient: receivingAddress,
    amountPlanck: amountToPlanck(finalAmount, PUSD_DECIMALS).toString(),
    terminalId: adminPayload?.terminalId,

  } : null;

  const qrValue = useQRGenerator(qrData);

  // Mark QR rendered as soon as we have a value to show — useful to split
  // "how fast did we generate the QR" from "how long did the customer take
  // to pay" in the waterfall.
  useEffect(() => {
    if (qrValue) journeyTracker.milestone("terminal-payment", "qr-generated");
  }, [qrValue]);

  // Sale-in-progress: while waiting for the offboard credit to land, the
  // listener is the only thing that can advance state. Locking out new sales
  // (calculator + nav) is the merchant-side counterpart to the QR's
  // lockAmount=true flag.
  const saleInProgress = terminalState === "qr" && !paymentReceived;

  // The listener only runs while the QR screen is awaiting payment. After
  // best-block detection we hand off finalization tracking to the singleton
  // in lib/payments/finalization-watcher.ts and tear this subscription down
  // so the merchant can start the next sale immediately. The watcher stamps
  // `finalizedAt` on the sale row when GRANDPA finality lands and history
  // surfaces the indicator.
  const listenerActive = !useCoins && !!receivingAddress && saleInProgress;

  const listenerOptions = listenerActive && receivingAddress ? {
    recipient: receivingAddress,
    onPaymentDetected: async (payment: PaymentDetected) => {
      console.log("[Terminal] Payment detected!", payment);
      journeyTracker.milestone("terminal-payment", "payment-detected");
      journeyTracker.addAttributes("terminal-payment", {
        "journey.sale_id": payment.saleId,
        "journey.block_number": payment.blockNumber ?? 0,
      });
      setPaymentReceived(payment);
      setSaleId(payment.saleId);

      // Persist the merchant address that actually received the payment —
      // that's the admin-configured payout when an admin payload is bound,
      // or the connected wallet for the standalone flow.
      const normalizedMerchant = normalizeToAssetHubAddress(receivingAddress);
      // Coinage offboard is privacy-preserving — the new "_and_vouchers"
      // pallet call doesn't expose the sender, so the listener gives us
      // the sentinel "anonymous". Skip normalization for that case.
      const normalizedCustomer = payment.from === "anonymous"
        ? "anonymous"
        : normalizeToAssetHubAddress(payment.from);

      // Snapshot cart lines as receipt items — these get persisted on the
      // sale record so a re-print from history shows the same itemized
      // breakdown, and they get included in the daily bulletin report.
      const receiptItems: ReceiptItem[] = pendingItems.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: formatAmountFromPlanck(line.pricePlanks, PUSD_DECIMALS),
      }));

      try {
        await addSale({
          saleId: payment.saleId,
          amount: formatAmountFromPlanck(payment.amount, PUSD_DECIMALS),
          amountPlanck: payment.amount,
          asset: getAssetSymbol(),
          assetId: ASSET_ID_STR,
          merchantAddress: normalizedMerchant,
          customerAddress: normalizedCustomer,
          merchantAddressNormalized: normalizedMerchant,
          customerAddressNormalized: normalizedCustomer,
          transactionHash: payment.blockHash,
          blockNumber: payment.blockNumber,
          blockHash: payment.blockHash,
          timestamp: new Date(),
          type: 'incoming',
          items: receiptItems.length > 0 ? receiptItems : undefined,
        });
        journeyTracker.milestone("terminal-payment", "sale-saved");
        console.log("[Terminal] Sale saved to local storage");

        // Hand off finalization tracking to the background watcher. The
        // sale row already exists with `finalizedAt: undefined`; the
        // watcher will stamp it once GRANDPA finality lands. Fire-and-
        // forget: this terminal page can unmount immediately after.
        watchForFinalization(payment.saleId, payment.blockHash);
      } catch (err) {
        console.error("[Terminal] Failed to save sale to local storage:", err);
        captureError(err, { component: "terminal", phase: "save-sale" }, {
          saleId: payment.saleId,
        });
      }

      const svg = await generateSvgReceipt({
        amount: formatAmountFromPlanck(payment.amount, PUSD_DECIMALS),
        asset: getAssetSymbol(),
        merchantAddress: normalizedMerchant,
        customerAddress: normalizedCustomer,
        transactionId: payment.blockHash,
        blockNumber: payment.blockNumber,
        blockHash: payment.blockHash,
        assetId: ASSET_ID_STR,
        saleId: payment.saleId,
        items: receiptItems.length > 0 ? receiptItems : undefined,
      });

      if (svg) {
        setSvgReceipt(svg);
        journeyTracker.milestone("terminal-payment", "receipt-generated");
      }
      // Sale is closed — drop the stashed cart so it can't leak to the next
      // sale if the merchant returns to /items without re-picking.
      clearPendingSale();
      setTerminalState("completed");
      journeyTracker.complete("terminal-payment");
      recordPaymentOutcome({
        outcome: "success",
        method: "voucher",
        amount: formatAmountFromPlanck(payment.amount, PUSD_DECIMALS),
        source: searchParams.get("source") ?? "direct",
        saleId: payment.saleId,
        terminalId: adminPayload?.terminalId,
        merchantId: adminPayload?.merchantId,
      });
    },
  } : null;

  usePaymentListener(listenerOptions);

  // W3S Coinage completion: the host has already moved the bearer coins into
  // the merchant coin set (paymentTopUp Coins) — the claim only resolves once
  // its extrinsics are in-block, and the host owns the submission. There's no
  // public sender and no inclusion block hash to track, so we record the sale
  // against the merchant identity with an "anonymous" customer and stamp it
  // finalized immediately (green check in History) rather than spinning.
  const handleCoinsPaid = async (result: CoinagePaymentResult) => {
    journeyTracker.milestone("terminal-payment", "payment-detected");
    journeyTracker.addAttributes("terminal-payment", {
      "journey.sale_id": result.paymentId,
    });

    const amountPlanck = amountToPlanck(result.amount, PUSD_DECIMALS).toString();
    const normalizedMerchant = receivingAddress
      ? normalizeToAssetHubAddress(receivingAddress)
      : "";

    const payment: PaymentDetected = {
      from: "anonymous",
      to: normalizedMerchant,
      amount: amountPlanck,
      assetId: ASSET_ID_STR,
      blockHash: result.paymentId,
      blockNumber: 0,
      saleId: result.paymentId,
      chain: "paseo-individuality",
    };
    setPaymentReceived(payment);
    setSaleId(result.paymentId);

    const receiptItems: ReceiptItem[] = pendingItems.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: formatAmountFromPlanck(line.pricePlanks, PUSD_DECIMALS),
    }));

    try {
      await addSale({
        saleId: result.paymentId,
        amount: result.amount,
        amountPlanck,
        asset: getAssetSymbol(),
        assetId: ASSET_ID_STR,
        merchantAddress: normalizedMerchant,
        customerAddress: "anonymous",
        merchantAddressNormalized: normalizedMerchant,
        customerAddressNormalized: "anonymous",
        transactionHash: result.paymentId,
        blockNumber: 0,
        blockHash: result.paymentId,
        timestamp: new Date(),
        // Coin claims confirm on the spot — the host already moved the coins
        // in-block. Stamp finalized now so History shows the green check
        // immediately (no finality spinner, unlike the standard pUSD flow).
        finalizedAt: new Date(),
        type: "incoming",
        items: receiptItems.length > 0 ? receiptItems : undefined,
      });
      journeyTracker.milestone("terminal-payment", "sale-saved");
    } catch (err) {
      console.error("[Terminal] Failed to save coins sale:", err);
      captureError(err, { component: "terminal", phase: "save-sale-coins" }, {
        saleId: result.paymentId,
      });
    }

    const svg = await generateSvgReceipt({
      amount: result.amount,
      asset: getAssetSymbol(),
      merchantAddress: normalizedMerchant,
      customerAddress: "anonymous",
      transactionId: result.paymentId,
      blockNumber: 0,
      blockHash: result.paymentId,
      assetId: ASSET_ID_STR,
      saleId: result.paymentId,
      items: receiptItems.length > 0 ? receiptItems : undefined,
    });
    if (svg) {
      setSvgReceipt(svg);
      journeyTracker.milestone("terminal-payment", "receipt-generated");
    }

    clearPendingSale();
    setTerminalState("completed");
    journeyTracker.complete("terminal-payment");
    recordPaymentOutcome({
      outcome: "success",
      method: "coins",
      amount: result.amount,
      source: searchParams.get("source") ?? "direct",
      saleId: result.paymentId,
      terminalId: adminPayload?.terminalId,
      merchantId: adminPayload?.merchantId,
    });
  };

  const coinage = useCoinagePayment(
    useCoins && saleInProgress
      ? {
          active: true,
          amount: finalAmount,
          onPaid: (result) => {
            void handleCoinsPaid(result);
          },
        }
      : null,
  );

  // The QR screen shows the Coinage deeplink when the coins method is active,
  // otherwise the standard pUSD payload.
  const displayQrValue = useCoins ? coinage.qrValue : qrValue;

  // Coins flow failure: the host's claim/top-up can error out (decrypt,
  // codec, or chain trouble). The voucher flow has no comparable terminal
  // failure — a missing payment is an abandon, not a failure — so this is the
  // only place we record a payment.outcome=failure. Fires once per transition
  // into the error state.
  useEffect(() => {
    if (!useCoins || coinage.status !== "error") return;
    recordPaymentOutcome({
      outcome: "failure",
      method: "coins",
      amount: finalAmount,
      source: searchParams.get("source") ?? "direct",
      terminalId: adminPayload?.terminalId,
      merchantId: adminPayload?.merchantId,
      reason: coinage.error ?? "coinage_error",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCoins, coinage.status]);

  const handleGenerateQR = () => {
    const amount = calculator.getNumericResult();
    if (!account || !amount || parseFloat(amount) <= 0) {
      return;
    }

    setIsGenerating(true);
    setFinalAmount(amount);

    setTimeout(() => {
      setIsGenerating(false);
      setTerminalState("qr");
    }, 500);
  };

  const handleReset = () => {
    // If a sale was still in progress (no payment yet), tracking treats
    // this as the merchant abandoning — silent no-op if already completed.
    journeyTracker.abandon("terminal-payment");
    // Clear in-route state first so any flash of the keypad fallback while
    // the navigation lands stays consistent.
    calculator.clear();
    setFinalAmount("");
    setPaymentReceived(null);
    setSaleId(null);
    setSvgReceipt(null);
    setShowCancelModal(false);
    // The keypad input state is dead — /terminal is only reachable from
    // /items checkout now. On cancel/done we always return to the menu.
    // `replace` (not `push`) so the back button doesn't bounce the
    // merchant back into a stale sale screen.
    clearPendingSale();
    router.replace("/items");
  };

  const handleCancelTransaction = () => {
    setShowCancelModal(false);
    handleReset();
  };

  const handleDownloadReceipt = async () => {
    if (!paymentReceived || !account) return;

    const receiptItems: ReceiptItem[] = pendingItems.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: formatAmountFromPlanck(line.pricePlanks, PUSD_DECIMALS),
    }));

    if (!receivingAddress) return;
    await downloadPdfReceipt({
      amount: formatAmountFromPlanck(paymentReceived.amount, PUSD_DECIMALS),
      asset: getAssetSymbol(),
      merchantAddress: normalizeToAssetHubAddress(receivingAddress),
      customerAddress: paymentReceived.from === "anonymous"
        ? "anonymous"
        : normalizeToAssetHubAddress(paymentReceived.from),
      transactionId: paymentReceived.blockHash,
      blockNumber: paymentReceived.blockNumber,
      blockHash: paymentReceived.blockHash,
      assetId: ASSET_ID_STR,
      saleId: paymentReceived.saleId,
      items: receiptItems.length > 0 ? receiptItems : undefined,
    });
  };


  if (!account) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
            <div className="text-center space-y-3 w-full">
              <h1 className="text-2xl font-semibold text-white">Welcome</h1>
              <p className="text-neutral-500 text-sm">Connecting to host…</p>
            </div>
          </main>
        </div>
        <BottomNav locked={saleInProgress} />
      </div>
    );
  }

  // Generating State - Centered loading with spinning logo
  if (terminalState === "input" && isGenerating) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4">
            <div className="p-2">
              <X className="w-6 h-6 text-transparent" />
            </div>
            <div className="w-10" />
            <div className="w-10" />
          </header>

          {/* Main Content - Centered */}
          <main className="flex-1 flex flex-col items-center justify-center px-6">
            {/* Spinning Polkadot Logo */}
            <div className="mb-8">
              <Image
                src="/polkadot_logo.jpg"
                alt="Processing"
                width={80}
                height={80}
                className="rounded-full animate-spin"
                style={{ animationDuration: "3s" }}
              />
            </div>

            {/* Processing Button */}
            <button
              disabled
              className="w-full bg-neutral-800 text-white font-medium py-4 rounded-xl flex items-center justify-center gap-3"
            >
              <span className="text-lg">Processing Payment</span>
            </button>
          </main>
        </div>

        <BottomNav locked={saleInProgress} />
      </div>
    );
  }

  // Input State - Calculator
  if (terminalState === "input") {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4">
            <Link href="/" className="p-2">
              <X className="w-6 h-6 text-white" />
            </Link>
            <div className="flex items-center gap-2">
              <Grid3X3 className="w-5 h-5 text-white" />
              <span data-testid="terminal-header" className="text-white font-medium">Payment Terminal</span>
            </div>
            <div className="w-10" />
          </header>

          {/* Main Content */}
          <main className="flex-1 flex flex-col px-6 py-4">
            {/* Amount Display */}
            <div className="mb-8">
              <p className="text-neutral-400 text-sm mb-2">Enter Payment Amount</p>
              <div className="flex items-baseline">
                <span className="text-white text-6xl font-light">$</span>
                <span data-testid="amount-display" className="text-white text-6xl font-light">
                  {calculator.getNumericResult()}
                </span>
                <span className="text-white text-6xl font-light animate-pulse">|</span>
              </div>
              {/* Expression display */}
              {calculator.expression && calculator.hasOperation && (
                <p className="text-neutral-500 text-sm mt-2 text-right">
                  {calculator.expression}
                </p>
              )}
            </div>

            {/* Calculator */}
            <div className="flex-1 flex flex-col justify-end space-y-3 mb-4">
              {/* Operators */}
              <div className="grid grid-cols-4 gap-3">
                {OPERATORS.map((op) => (
                  <button
                    key={op}
                    onClick={() => calculator.inputOperator(op)}
                    className="bg-neutral-800 hover:bg-neutral-700 text-white text-xl font-medium py-4 rounded-xl transition"
                  >
                    {op}
                  </button>
                ))}
              </div>

              {/* Number Pad */}
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
                  <button
                    key={key}
                    data-testid={`calc-digit-${key}`}
                    onClick={() => calculator.inputDigit(key)}
                    className="bg-neutral-900 hover:bg-neutral-800 text-white text-2xl font-medium py-5 rounded-xl transition border border-neutral-800"
                  >
                    {key}
                  </button>
                ))}
                <button
                  data-testid="calc-decimal"
                  onClick={() => calculator.inputDecimal()}
                  className="bg-neutral-900 hover:bg-neutral-800 text-white text-2xl font-medium py-5 rounded-xl transition border border-neutral-800"
                >
                  .
                </button>
                <button
                  data-testid="calc-digit-0"
                  onClick={() => calculator.inputDigit("0")}
                  className="bg-neutral-900 hover:bg-neutral-800 text-white text-2xl font-medium py-5 rounded-xl transition border border-neutral-800"
                >
                  0
                </button>
                <button
                  data-testid="calc-backspace"
                  onClick={() => calculator.backspace()}
                  className="bg-neutral-900 hover:bg-neutral-800 text-white text-2xl font-medium py-5 rounded-xl transition border border-neutral-800 flex items-center justify-center"
                >
                  <Delete className="w-6 h-6" />
                </button>
              </div>

              {/* Generate Button */}
              <button
                data-testid="btn-generate-qr"
                onClick={handleGenerateQR}
                disabled={!calculator.getNumericResult() || parseFloat(calculator.getNumericResult()) <= 0}
                className="w-full bg-white hover:bg-neutral-100 disabled:bg-neutral-800 disabled:text-neutral-500 text-black font-semibold py-4 rounded-xl transition text-lg mt-4"
              >
                Generate QR Code
              </button>
            </div>
          </main>
        </div>

        <BottomNav locked={saleInProgress} />
      </div>
    );
  }

  // QR Code State - Waiting for payment
  if (terminalState === "qr") {
    // Coins mode: the first sign a payment is on its way is the cheque landing
    // on our statement-store topic (status flips to "claiming", then "paid"
    // once the host claim goes through). Until then we just show the QR. At
    // that moment we hide the QR and spin, so the merchant sees the payment is
    // arriving. Standard (Voucher) mode keeps its always-on waiting animation.
    const paymentIncoming =
      useCoins &&
      (coinage.status === "claiming" || coinage.status === "paid");
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4">
            <button onClick={() => setShowCancelModal(true)} className="p-2">
              <X className="w-6 h-6 text-white" />
            </button>
            <div className="w-10" />
            <div className="w-10" />
          </header>

          {/* Main Content */}
          <main className="flex-1 flex flex-col items-center justify-center px-6">
            {/* Polkadot Logo — spins only while a payment is actively coming
                in (Coins mode), or throughout for Voucher mode. */}
            <div className="mb-4">
              <Image
                src="/polkadot_logo.jpg"
                alt="Loading"
                width={64}
                height={64}
                className={`rounded-full ${!useCoins || paymentIncoming ? "animate-spin" : ""}`}
                style={{ animationDuration: "3s" }}
              />
            </div>

            <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300 text-xs font-medium tracking-wide uppercase">Sale in progress</span>
            </div>

            <h2 data-testid="waiting-text" className="text-white text-2xl font-medium mb-6">
              {paymentIncoming ? "Payment incoming…" : "Waiting for payment..."}
            </h2>

            <p className="text-neutral-400 text-sm mb-2">Receiving Amount</p>
            <p data-testid="qr-amount" className="text-white text-5xl font-light mb-8">{finalAmount} {symbol}</p>

            {/* QR Code — replaced by a spinner once the payment starts arriving. */}
            <div
              data-testid="qr-code"
              className={`rounded-2xl p-6 mb-6 ${paymentIncoming ? "" : "bg-white"}`}
            >
              {paymentIncoming ? (
                <div className="w-[220px] h-[220px] flex items-center justify-center">
                  <Loader2 className="w-10 h-10 animate-spin text-neutral-300" />
                </div>
              ) : displayQrValue ? (
                <QRCodeSVG value={displayQrValue} size={220} level="H" />
              ) : (
                <div className="w-[220px] h-[220px] flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
                </div>
              )}
            </div>

            {useCoins && coinage.status === "error" && coinage.error && (
              <p className="text-neutral-500 text-xs mb-4 text-center max-w-xs">
                {coinage.error}
              </p>
            )}

            {/* Action Buttons */}
            <div className="w-full space-y-3">
              <button
                onClick={() => setShowCancelModal(true)}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-4 rounded-xl transition"
              >
                Cancel Transaction
              </button>
            </div>
          </main>
        </div>

        <BottomNav locked={saleInProgress} />

        {/* Cancel Modal */}
        {showCancelModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-6">
            <div className="bg-neutral-900 rounded-2xl w-full max-w-sm p-6">
              <div className="flex flex-col items-center mb-6">
                <p className="text-white text-lg font-medium text-center">Do you want to cancel</p>
                <p className="text-white text-lg font-medium text-center">this transaction?</p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-4 rounded-xl transition"
                >
                  Close
                </button>
                <button
                  onClick={handleCancelTransaction}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-4 rounded-xl transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Payment Completed State
  if (terminalState === "completed") {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4">
            <button onClick={handleReset} className="p-2">
              <X className="w-6 h-6 text-white" />
            </button>
            <div className="w-10" />
            <div className="w-10" />
          </header>

          {/* Main Content */}
          <main className="flex-1 flex flex-col items-center justify-center px-6">
            {/* Success Icon */}
            <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-6">
              <Check className="w-10 h-10 text-white" strokeWidth={3} />
            </div>

            <h2 data-testid="payment-completed" className="text-white text-2xl font-medium mb-6">Payment completed</h2>

            {/* No finality indicator here — best-block is the merchant-side
                terminal state. GRANDPA finalization is stamped on the sale
                record asynchronously by lib/payments/finalization-watcher.ts
                and surfaced as a checkmark in /history. */}

            {/* Payment Info */}
            <div className="text-center mb-8">
              <p className="text-green-400 text-5xl font-light">+{finalAmount} {symbol}</p>
              <p className="text-neutral-500 text-sm mt-2">
                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
            </div>

            {/* Sale ID */}
            <div className="w-full mb-8">
              <div className="flex justify-between items-center py-3 border-t border-neutral-800">
                <span className="text-neutral-400">Sale ID</span>
                <span data-testid="sale-id" className="text-white font-mono">{saleId?.slice(-4) || "----"}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="w-full space-y-3">
              <button
                onClick={() => setTerminalState("share")}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-4 rounded-xl transition flex items-center justify-center gap-2"
              >
                <Share2 className="w-5 h-5" />
                Share Record via QR
              </button>
              <button
                onClick={() => setTerminalState("receipt")}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-medium py-4 rounded-xl transition"
              >
                Review Record
              </button>
              <button
                data-testid="btn-done"
                onClick={handleReset}
                className="w-full bg-white hover:bg-neutral-100 text-black font-semibold py-4 rounded-xl transition"
              >
                Done
              </button>
            </div>
          </main>
        </div>

        <BottomNav locked={saleInProgress} />
      </div>
    );
  }

  // Share Receipt State
  if (terminalState === "share") {
    // The shared QR carries the exact same self-contained receipt envelope
    // that's printed on the receipt — scanning it rebuilds the full receipt
    // offline (no `/receipt/<id>` round-trip). Built from the same data the
    // listener used to render the receipt, so the two QRs are identical.
    const shareReceiptItems: ReceiptItem[] = pendingItems.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unitPrice: formatAmountFromPlanck(line.pricePlanks, PUSD_DECIMALS),
    }));
    const shareQrValue = paymentReceived && receivingAddress
      ? buildReceiptQrValue({
          amount: formatAmountFromPlanck(paymentReceived.amount, PUSD_DECIMALS),
          asset: getAssetSymbol(),
          merchantAddress: normalizeToAssetHubAddress(receivingAddress),
          customerAddress: paymentReceived.from === "anonymous"
            ? "anonymous"
            : normalizeToAssetHubAddress(paymentReceived.from),
          transactionId: paymentReceived.blockHash,
          blockNumber: paymentReceived.blockNumber,
          blockHash: paymentReceived.blockHash,
          assetId: ASSET_ID_STR,
          saleId: paymentReceived.saleId,
          items: shareReceiptItems.length > 0 ? shareReceiptItems : undefined,
        })
      : "";
    return (
      <div className="min-h-screen bg-neutral-100 flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4 bg-neutral-100">
            <button onClick={() => setTerminalState("completed")} className="p-2">
              <span className="text-black">&lt;</span>
            </button>
            <span className="text-black font-medium">Share Record</span>
            <div className="w-10" />
          </header>

          {/* Main Content */}
          <main className="flex-1 flex flex-col items-center justify-center px-6">
            <p className="text-neutral-500 text-sm mb-2">Payment Record #{saleId?.slice(-4)}</p>
            <h2 className="text-black text-xl font-medium mb-8">Scan QR to Receive Record</h2>

            {/* QR Code */}
            <div className="bg-white rounded-2xl p-8 shadow-lg mb-8">
              <QRCodeSVG
                value={shareQrValue}
                size={200}
                level="L"
              />
            </div>

            <button
              onClick={() => setTerminalState("completed")}
              className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-medium py-4 rounded-xl transition"
            >
              Back
            </button>
          </main>
        </div>
      </div>
    );
  }

  // Receipt Review State
  if (terminalState === "receipt") {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-4">
            <button onClick={() => setTerminalState("completed")} className="p-2">
              <X className="w-6 h-6 text-white" />
            </button>
            <span className="text-white font-medium">Payment Record #{saleId?.slice(-4)}</span>
            <button onClick={handleDownloadReceipt} className="p-2">
              <Download className="w-6 h-6 text-white" />
            </button>
          </header>

          {/* Receipt Content */}
          <main className="flex-1 flex flex-col px-6 py-4 overflow-auto">
            {svgReceipt ? (
              <div className="bg-white rounded-xl p-4 overflow-hidden">
                <div dangerouslySetInnerHTML={{ __html: svgReceipt }} />
              </div>
            ) : (
              <div className="bg-white rounded-xl p-6">
                <div className="border-b border-neutral-200 pb-4 mb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-black">PAYMENT RECEIPT</h3>
                      <p className="text-xs text-neutral-500">Block: {paymentReceived?.blockNumber}</p>
                    </div>
                    <span className="text-sm text-neutral-500">#{saleId?.slice(-4)}</span>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">TRANSACTION ID</span>
                    <span className="text-black font-mono">{saleId?.slice(-4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">DATE</span>
                    <span className="text-black">{new Date().toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500">FROM:</span>
                    <p className="text-black font-mono text-xs break-all">{paymentReceived?.from}</p>
                  </div>
                  <div>
                    <span className="text-neutral-500">TO:</span>
                    <p className="text-black font-mono text-xs break-all">{account?.address}</p>
                  </div>
                  <div className="flex justify-between pt-4 border-t border-neutral-200">
                    <span className="text-neutral-500">TOTAL</span>
                    <span className="text-black text-xl font-semibold">{finalAmount} {symbol}</span>
                  </div>
                </div>
              </div>
            )}

          </main>
        </div>

        <BottomNav locked={saleInProgress} />
      </div>
    );
  }

  return null;
}
