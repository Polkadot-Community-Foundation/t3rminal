import { describe, expect, it } from "vitest";
import { classifyTopupError } from "@/lib/payments/coinage/topup-error";

describe("classifyTopupError", () => {
  it("maps known host shapes to stable kinds", () => {
    expect(classifyTopupError(new Error("request timed out"))).toBe("timeout");
    expect(classifyTopupError({ tag: "Declined", value: { reason: "insufficient" } })).toBe("declined");
    expect(classifyTopupError(new Error("host bridge unavailable"))).toBe("host");
    expect(classifyTopupError(new Error("weird"))).toBe("unknown");
  });
});
