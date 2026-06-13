import { describe, expect, it, vi } from "vitest";

const spanSetAttrs: Array<[string, unknown]> = [];

vi.mock("@sentry/nextjs", () => {
  const calls: any = { breadcrumbs: [], messages: [], rootSetAttrs: [], startSpanAttrs: [] };
  const fakeRoot = { setAttribute: (k: string, v: unknown) => calls.rootSetAttrs.push([k, v]) };
  return {
    addBreadcrumb: (b: unknown) => calls.breadcrumbs.push(b),
    captureMessage: (m: string, o: unknown) => calls.messages.push([m, o]),
    getActiveSpan: () => ({}),
    getRootSpan: () => fakeRoot,
    startSpan: (opts: any, cb: any) => {
      calls.startSpanAttrs.push(opts.attributes ?? {});
      const spanStub = {
        setStatus: () => {},
        setAttribute: (k: string, v: unknown) => calls.startSpanAttrs.at(-1).__spanSetAttr = [k, v],
      };
      try {
        return cb(spanStub);
      } catch (e) {
        throw e;
      }
    },
    __calls: calls,
  };
});

import * as Sentry from "@sentry/nextjs";
import { isExpectedError, captureWarning, withSpan } from "@/lib/telemetry/sentry-helpers";

describe("isExpectedError", () => {
  it("classifies user/external causes as expected", () => {
    for (const m of [
      "Insufficient funds for this payment",
      "Payment cancelled by user",
      "Network offline — check your connection",
      "Terminal is not bound — scan an admin QR",
      "finalization_timeout",
    ]) {
      expect(isExpectedError(m)).toBe(true);
    }
  });
  it("classifies arbitrary bugs as unexpected", () => {
    expect(isExpectedError("Cannot read properties of undefined (reading 'foo')")).toBe(false);
    expect(isExpectedError(undefined)).toBe(false);
  });
});

describe("captureWarning", () => {
  it("emits a breadcrumb + message and marks the root span sad", () => {
    captureWarning("RPC reconnect", { attempt: 2 });
    const calls = (Sentry as any).__calls;
    expect(calls.breadcrumbs.at(-1)).toMatchObject({ level: "warning", message: "RPC reconnect" });
    expect(calls.messages.at(-1)[0]).toBe("RPC reconnect");
    expect(calls.rootSetAttrs.at(-1)).toEqual(["op.sad", "true"]);
  });
  it("never throws", () => {
    expect(() => captureWarning("x")).not.toThrow();
  });
});

describe("withSpan op.sad", () => {
  it("defaults op.sad to 'false' on success", () => {
    const calls = (Sentry as any).__calls;
    calls.startSpanAttrs.length = 0;
    withSpan("test-op", "test.op", () => "ok");
    const attrs = calls.startSpanAttrs.at(-1)!;
    expect(attrs["op.sad"]).toBe("false");
    // No setAttribute("op.sad","true") on success
    expect(attrs.__spanSetAttr).toBeUndefined();
  });

  it("flips op.sad to 'true' on throw (sync)", () => {
    const calls = (Sentry as any).__calls;
    calls.startSpanAttrs.length = 0;
    expect(() =>
      withSpan("test-op", "test.op", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const attrs = calls.startSpanAttrs.at(-1)!;
    expect(attrs["op.sad"]).toBe("false"); // default set at span start
    expect(attrs.__spanSetAttr).toEqual(["op.sad", "true"]); // flipped in catch
  });
});
