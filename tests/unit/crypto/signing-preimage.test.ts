import { describe, expect, it } from "vitest";
import { buildSignaturePreimage } from "../../../src/services/crypto/signing-preimage";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("services/crypto/signing-preimage (#287)", () => {
  const canonicalPayload = '{"key":"value"}';

  it("emits the documented length-prefixed preimage", () => {
    const result = buildSignaturePreimage(canonicalPayload, {
      network: "testnet",
      operation: "envelope_signature",
    });

    expect(decode(result)).toBe(
      `stealth-preimage-v2|21:Stealth_Mail_Protocol|2:v1|7:testnet|18:envelope_signature|15:${canonicalPayload}`,
    );
  });

  it("distinguishes (network, operation) splits of the same colon-joined string", () => {
    const first = buildSignaturePreimage(canonicalPayload, { network: "a:b", operation: "c" });
    const second = buildSignaturePreimage(canonicalPayload, { network: "a", operation: "b:c" });

    expect(decode(first)).not.toBe(decode(second));
    expect(first).not.toEqual(second);
  });

  it("counts UTF-8 bytes, not UTF-16 code units, in the field lengths", () => {
    const result = buildSignaturePreimage("é", { network: "mäin", operation: "öps" });

    expect(decode(result)).toBe(
      "stealth-preimage-v2|21:Stealth_Mail_Protocol|2:v1|5:mäin|4:öps|2:é",
    );
  });

  it("carries the protocol version and allows overriding it", () => {
    const result = buildSignaturePreimage("data", {
      network: "public",
      operation: "op",
      version: "v2",
    });

    expect(decode(result)).toBe(
      "stealth-preimage-v2|21:Stealth_Mail_Protocol|2:v2|6:public|2:op|4:data",
    );
  });
});
