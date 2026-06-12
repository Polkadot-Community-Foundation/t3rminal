import { describe, expect, it } from "vitest";
import { commonInitOptions } from "@/lib/telemetry/sentry-init";
import { scrubEvent, scrubTransaction } from "@/lib/telemetry/scrub";

describe("commonInitOptions wiring", () => {
  it("attaches the PII scrub hooks", () => {
    const o = commonInitOptions();
    expect(o.beforeSend).toBe(scrubEvent);
    expect(o.beforeSendTransaction).toBe(scrubTransaction);
  });
  it("reads environment + DSN-gates enabled", () => {
    const o = commonInitOptions();
    expect(typeof o.environment).toBe("string");
    expect(o.enabled).toBe((process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").length > 0);
  });
});
