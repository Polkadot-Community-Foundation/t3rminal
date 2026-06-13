import { afterEach, describe, expect, it } from "vitest";

import {
  truncateAddress,
  registerSecret,
  _clearSecretsForTest,
  scrubEvent,
  scrubTransaction,
} from "@/lib/telemetry/scrub";

afterEach(() => _clearSecretsForTest());

describe("truncateAddress", () => {
  it("truncates long addresses to 8 chars + ellipsis", () => {
    expect(truncateAddress("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY")).toBe("5GrwvaEF…");
  });
  it("leaves short strings and falsy values untouched", () => {
    expect(truncateAddress("5Grwva")).toBe("5Grwva");
    expect(truncateAddress(undefined)).toBeUndefined();
    expect(truncateAddress("")).toBe("");
  });
});

describe("scrubEvent — registered secrets", () => {
  it("redacts a registered secret from message, exception value, and breadcrumb message", () => {
    registerSecret("S3CR3T-report-password-value-aaaaaaaaaaaaa");
    const ev = {
      message: "boom with S3CR3T-report-password-value-aaaaaaaaaaaaa in it",
      exception: { values: [{ value: "threw S3CR3T-report-password-value-aaaaaaaaaaaaa" }] },
      breadcrumbs: [{ message: "leaked S3CR3T-report-password-value-aaaaaaaaaaaaa here" }],
    } as any;
    const out = scrubEvent(ev) as any;
    expect(out.message).not.toContain("S3CR3T");
    expect(out.message).toContain("[redacted]");
    expect(out.exception.values[0].value).not.toContain("S3CR3T");
    expect(out.breadcrumbs[0].message).not.toContain("S3CR3T");
  });

  it("redacts values under sensitive keys and truncates address keys in breadcrumb data", () => {
    const ev = {
      breadcrumbs: [
        { message: "x", data: { reportPassword: "anything-here", receivingAddress: "5GrwvaEF5zXb26Fz9rcQpDWS57Ct" } },
      ],
    } as any;
    const out = scrubEvent(ev) as any;
    expect(out.breadcrumbs[0].data.reportPassword).toBe("[redacted]");
    expect(out.breadcrumbs[0].data.receivingAddress).toBe("5GrwvaEF…");
  });

  it("scrubs event.extra (where captureError's 3rd arg lands)", () => {
    registerSecret("S3CR3T-extra-pw-cccccccccccccccc");
    const ev = {
      extra: {
        reportPassword: "leaked-here",
        receivingAddress: "5GrwvaEF5zXb26Fz9rcQpDWS57Ct",
        note: "ctx S3CR3T-extra-pw-cccccccccccccccc trailing",
        date: "2026-06-13",
      },
    } as any;
    const out = scrubEvent(ev) as any;
    expect(out.extra.reportPassword).toBe("[redacted]");
    expect(out.extra.receivingAddress).toBe("5GrwvaEF…");
    expect(out.extra.note).not.toContain("S3CR3T");
    expect(out.extra.date).toBe("2026-06-13");
  });
});

describe("scrubTransaction", () => {
  it("scrubs span data and contexts.trace.data", () => {
    registerSecret("S3CR3T-pw-bbbbbbbbbbbbbbbbbbbbbbbbb");
    const ev = {
      spans: [{ data: { "payment.note": "has S3CR3T-pw-bbbbbbbbbbbbbbbbbbbbbbbbb", "signer.address": "5GrwvaEF5zXb26Fz9rcQpDWS" } }],
      contexts: { trace: { data: { reportPassword: "zzz", "payment.amount": "12.50" } } },
    } as any;
    const out = scrubTransaction(ev) as any;
    expect(out.spans[0].data["payment.note"]).not.toContain("S3CR3T");
    expect(out.spans[0].data["signer.address"]).toBe("5GrwvaEF…");
    expect(out.contexts.trace.data.reportPassword).toBe("[redacted]");
    expect(out.contexts.trace.data["payment.amount"]).toBe("12.50");
  });
});
