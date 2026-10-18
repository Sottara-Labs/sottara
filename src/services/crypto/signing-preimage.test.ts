import { describe, expect, it } from "vitest";
import {
  buildSignaturePreimage,
  PREIMAGE_FORMAT_PREFIX,
  STEALTH_DOMAIN_TAG,
  STEALTH_PROTOCOL_VERSION,
  type SignaturePreimageOptions,
} from "./signing-preimage";

function field(value: string): string {
  const byteLength = new TextEncoder().encode(value).length;
  return `${byteLength}:${value}`;
}

function expectedPreimage(payload: string, options: SignaturePreimageOptions): string {
  const version = options.version ?? STEALTH_PROTOCOL_VERSION;
  return (
    PRIIMAGE_FORMAT_PREFIX +
    field(STEALTH_DOMAIN_TAG) +
    field(version) +
    field(options.network) +
    field(options.operation) +
    field(payload)
  );
}

describe("services/crypto/signing-preimage", () => {
  it("builds a deterministic domain-separated preimage", () => {
    const payload = '{"key":"value"}';
    const options = {
      network: "testnet",
      operation: "envelope_signature",
    };
    const result = buildSignaturePreimage(payload, options);

    const expectedBytes = new TextEncoder().encode(expectedPreimage(payload, options));

    expect(result).toEqual(expectedBytes);
  });

  it("prefixes each field with its UTF-8 byte length", () => {
    const result = buildSignaturePreimage("data", {
      network: "public",
      operation: "op",
    });

    const decoded = new TextDecoder().decode(result);
    expect(decoded).startsWith(PREIMAGE_FORMAT_PREFIX);
    expect(decoded).toContain(`${STEALTH_DOMAIN_TAG.length}:${STEALTH_DOMAIN_TAG}`);
    expect(decoded).toContain(`${STEALTH_PROTOCOL_VERSION.length}:${STEALTH_PROTOCOL_VERSION}`);
    expect(decoded).toContain("6:ipublic");
    expect(decoded).toContain("2:op");
    expect(decoded).toContain("4:data");
  });

  it("allows overriding the protocol version", () => {
    const options = {
      network: "public",
      operation: "op",
      version: "v2",
    };
    const result = buildSignaturePreimage("data", options);

    expect(new TextDecoder().decode(result)).toBe(expectedPreimage("data", options));
  });

  it("produces different preimages for different (network, operation) splits of the same string", () => {
    const payload = "data";
    const a = buildSignaturePreimage(payload, {
      network: "a:b",
      operation: "c",
    });
    const b = buildSignaturePreimage(payload, {
      network: "a",
      operation: "b:c",
    });

    expect(a).not.toEqual(b);
  });

  it("produces different preimages when a delimiter is moved across field boundaries", () => {
    const payload = "data";
    const a = buildSignaturePreimage(payload, {
      network: "testnet",
      operation: "op:1",
    });
    const b = buildSignaturePreimage(payload, {
      network: "testnet:op",
      operation: "1",
    });

    expect(a).not.toEqual(b);
  });

  it("should fail validation if domain tag conceptually changes (represented by different output)", () => {
    const payload = '{"key":"value"}';
    const result = buildSignaturePreimage(payload, {
      network: "testnet",
      operation: "envelope_signature",
    });

    const wrongDomainString = `${PREIMAGE_FORMAT_PREFIX}${field("Wrong_Domain")}${field(STEALTH_PROTOCOL_VERSION)}${field("testnet")}${field("envelope_signature")}${field(payload)}`;
    const wrongBytes = new TextEncoder().encode(wrongDomainString);

    expect(result).not.toEqual(wrongBytes);
  });
});
