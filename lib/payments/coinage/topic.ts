/**
 * Statement-store topic derivation for the internal (T3rminal) Coinage flow.
 *
 * The terminal chooses the payment `id` it puts in the deeplink and listens on
 *   topic = blake2b256("pay-w3s:" || id)   (32 bytes)
 * The customer's app derives the same topic from the `id` it reads out of the
 * deeplink, so both ends agree without the topic ever being transmitted.
 * (Appendix E / F.)
 */

import { blake2b256 } from "@polkadot-labs/hdkd-helpers";

const TOPIC_PREFIX = new TextEncoder().encode("pay-w3s:");

export function deriveTopic(id: string): Uint8Array {
  const idBytes = new TextEncoder().encode(id);
  const input = new Uint8Array(TOPIC_PREFIX.length + idBytes.length);
  input.set(TOPIC_PREFIX, 0);
  input.set(idBytes, TOPIC_PREFIX.length);
  const topic = blake2b256(input);
  if (topic.length !== 32) {
    throw new Error(`derived topic must be 32 bytes (got ${topic.length})`);
  }
  return topic;
}
