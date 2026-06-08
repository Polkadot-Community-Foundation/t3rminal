/**
 * W3S Coinage terminal-side unit tests.
 *
 * The on-host claim (statement-store subscribe + paymentTopUp) can't run
 * outside the Polkadot app container, but the pieces the terminal owns are
 * pure and pinned here:
 *
 *  1. Amount normalization to the 2dp shape the Android sender emits.
 *  2. Topic derivation == blake2b256("pay-w3s:" || id) (both ends compute
 *     this independently from the deeplink `id`).
 *  3. Deeplink format + Base64URL of the compressed ephemeral pubkey.
 *  4. The headline interop: a fresh terminal keypair round-trips a full ECIES
 *     "cheque" produced the way the customer app produces it — proving our
 *     keygen + decrypt path agree with the sender on the wire.
 *
 * `deriveEntropy` is mocked so keygen falls back to the browser CSPRNG path
 * (no host bridge in the node test env).
 */

import { describe, expect, it, vi } from "vitest";
import { gcm } from "@noble/ciphers/aes.js";
import { blake2b256 } from "@polkadot-labs/hdkd-helpers";
import {
  decompressP256,
  decryptStatementData,
  deriveAesKey,
} from "@/lib/payments/coinage/ecies";
import {
  encodeW3sEncryptedPayloadV1,
  encodeW3sPaymentDataV1,
} from "@/lib/payments/coinage/codec";

// No host in the node test env — force the CSPRNG fallback in keys.ts.
vi.mock("@novasamatech/host-api-wrapper", () => ({
  deriveEntropy: () => {
    throw new Error("no host bridge in test");
  },
}));

import { generateEphemeralKeypair, generatePaymentId } from "@/lib/payments/coinage/keys";
import { deriveTopic } from "@/lib/payments/coinage/topic";
import {
  buildPayW3sDeeplink,
  normalizeAmount,
  PAY_W3S_DEEPLINK_BASE,
} from "@/lib/payments/coinage/deeplink";

function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

describe("normalizeAmount", () => {
  it("forces exactly two decimal places", () => {
    expect(normalizeAmount("12")).toBe("12.00");
    expect(normalizeAmount("12.5")).toBe("12.50");
    expect(normalizeAmount("12.50")).toBe("12.50");
    expect(normalizeAmount("0")).toBe("0.00");
  });

  it("rejects out-of-range / malformed amounts", () => {
    expect(() => normalizeAmount("10000.01")).toThrow();
    expect(() => normalizeAmount("-1")).toThrow();
    expect(() => normalizeAmount("abc")).toThrow();
  });
});

describe("deriveTopic", () => {
  it("is a deterministic 32-byte blake2b256 of the prefixed id", () => {
    const id = "deadbeef";
    const topic = deriveTopic(id);
    expect(topic.length).toBe(32);

    const expected = blake2b256(
      concatBytes(new TextEncoder().encode("pay-w3s:"), new TextEncoder().encode(id)),
    );
    expect(Array.from(topic)).toEqual(Array.from(expected));

    // Same id → same topic; different id → different topic.
    expect(Array.from(deriveTopic(id))).toEqual(Array.from(topic));
    expect(Array.from(deriveTopic("other"))).not.toEqual(Array.from(topic));
  });
});

describe("buildPayW3sDeeplink", () => {
  it("emits a well-formed deeplink with a Base64URL compressed key", async () => {
    const { publicKeyCompressed } = await generateEphemeralKeypair();
    const url = buildPayW3sDeeplink({
      id: "abc123",
      amount: "3.5",
      publicKeyCompressed,
    });

    expect(url.startsWith(`${PAY_W3S_DEEPLINK_BASE}?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("id")).toBe("abc123");
    expect(params.get("amount")).toBe("3.50"); // normalized
    // key decodes back to the exact compressed pubkey
    expect(Array.from(base64urlDecode(params.get("key")!))).toEqual(
      Array.from(publicKeyCompressed),
    );
  });
});

describe("generateEphemeralKeypair", () => {
  it("returns a 33-byte SEC1-compressed pubkey and is unique per call", async () => {
    const a = await generateEphemeralKeypair();
    const b = await generateEphemeralKeypair();

    expect(a.privateKey.length).toBe(32);
    expect(a.publicKeyCompressed.length).toBe(33);
    expect([0x02, 0x03]).toContain(a.publicKeyCompressed[0]);
    expect(Array.from(a.privateKey)).not.toEqual(Array.from(b.privateKey));
  });
});

describe("generatePaymentId", () => {
  it("is non-empty lowercase alphanumeric and unique", () => {
    const id = generatePaymentId();
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBeGreaterThan(0);
    expect(generatePaymentId()).not.toBe(id);
  });
});

describe("ECIES cheque round-trip (terminal keygen ↔ sender encrypt ↔ receiver decrypt)", () => {
  it("decrypts a sender-built envelope with the terminal's private key", async () => {
    // Terminal mints the per-sale keypair; it publishes the compressed pubkey.
    const terminal = await generateEphemeralKeypair();
    const terminalPubUncompressed = decompressP256(terminal.publicKeyCompressed);

    // Customer app: fresh ephemeral key, ECDH against the terminal pubkey.
    const sender = await generateEphemeralKeypair();
    const senderPubUncompressed = decompressP256(sender.publicKeyCompressed);
    const aesKey = deriveAesKey(sender.privateKey, terminalPubUncompressed);

    const original = {
      amount: "3.00",
      timestamp: 1_700_000_000_000n,
      // Coins are 64-byte sr25519 secrets (scalar ‖ nonce), per the Android sender.
      coins: [new Uint8Array(64).fill(7), new Uint8Array(64).fill(9)],
      id: "salexyz",
    };
    const plaintext = encodeW3sPaymentDataV1(original);

    // AES-256-GCM: envelope ciphertext is IV(12) || ct || tag(16).
    const iv = new Uint8Array(12).fill(3);
    const ctTag = gcm(aesKey, iv).encrypt(plaintext);
    const encryptedData = concatBytes(iv, ctTag);

    const envelopeBytes = encodeW3sEncryptedPayloadV1({
      encryptedData,
      ephemeralPublicKey: senderPubUncompressed,
    });

    const { payload } = decryptStatementData(terminal.privateKey, envelopeBytes);

    expect(payload.id).toBe(original.id);
    expect(payload.amount).toBe(original.amount);
    expect(payload.timestamp).toBe(original.timestamp);
    expect(payload.coins).toHaveLength(2);
    expect(payload.coins[0].length).toBe(64);
    expect(Array.from(payload.coins[0])).toEqual(Array.from(original.coins[0]));
  });
});
