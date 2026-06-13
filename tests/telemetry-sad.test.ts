import { describe, expect, it, vi, beforeEach } from "vitest";

const startSpanAttrs: Array<Record<string, unknown>> = [];

vi.mock("@sentry/nextjs", () => ({
  startSpan: (opts: any, cb: any) => {
    startSpanAttrs.push(opts.attributes ?? {});
    return cb({ setStatus: () => {}, setAttribute: () => {} });
  },
  startSpanManual: (opts: any, cb: any) => {
    startSpanAttrs.push(opts.attributes ?? {});
    return cb({ setStatus: () => {}, setAttribute: () => {}, end: () => {} });
  },
  setMeasurement: () => {},
  addBreadcrumb: () => {},
}));

import { recordPaymentOutcome, recordFinalizationLatency } from "@/lib/telemetry/payment-metrics";
import { journeyTracker } from "@/lib/telemetry/journey-tracker";

beforeEach(() => { startSpanAttrs.length = 0; });

describe("payment.sad", () => {
  it("is 'false' on success and 'true' on failure", () => {
    recordPaymentOutcome({ outcome: "success", method: "voucher" });
    expect(startSpanAttrs.at(-1)!["payment.sad"]).toBe("false");
    recordPaymentOutcome({ outcome: "failure", method: "coins", reason: "declined" });
    expect(startSpanAttrs.at(-1)!["payment.sad"]).toBe("true");
  });
});

describe("finalization.sad", () => {
  it("is 'false' when finalized and 'true' on timeout", () => {
    recordFinalizationLatency({ saleId: "s1", latencyMs: 1200, finalized: true });
    expect(startSpanAttrs.at(-1)!["finalization.sad"]).toBe("false");
    recordFinalizationLatency({ saleId: "s2", latencyMs: 9000, finalized: false });
    expect(startSpanAttrs.at(-1)!["finalization.sad"]).toBe("true");
  });
});

describe("journey.sad", () => {
  it("defaults to 'false' on a clean complete()", () => {
    journeyTracker.start("page-load");
    journeyTracker.complete("page-load");
    const attrs = startSpanAttrs.find((a) => a["journey.type"] === "page-load")!;
    expect(attrs["journey.sad"]).toBe("false");
  });

  it("is 'true' after markSad(), and 'true' on fail()", () => {
    journeyTracker.start("authenticate");
    journeyTracker.markSad("authenticate");
    journeyTracker.complete("authenticate");
    const ok = startSpanAttrs.find((a) => a["journey.type"] === "authenticate")!;
    expect(ok["journey.sad"]).toBe("true");

    journeyTracker.start("items-checkout");
    journeyTracker.fail("items-checkout", "boom");
    const failed = startSpanAttrs.find((a) => a["journey.type"] === "items-checkout")!;
    expect(failed["journey.sad"]).toBe("true");
  });
});
