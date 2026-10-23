import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  capabilitiesMatchRegistry,
  CRYPTO_SUITE_REGISTRY,
  getCryptoCapabilities,
} from "../../../src/services/crypto/capabilities";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_BODY_BYTES,
} from "../../../src/services/crypto/limits";

describe("crypto capability descriptor (#1709)", () => {
  it("lists supported versions, suites, key formats, and limits", () => {
    const caps = getCryptoCapabilities();
    expect(caps.envelopeVersion).toBe("v1");
    expect(caps.suites.length).toBeGreaterThan(0);
    expect(caps.suites[0].name).toBe("AES-256-GCM");
    expect(caps.keyFormats).toContain("raw");
    expect(caps.limits.maxBodyBytes).toBe(64 * 1024);
  });

  it("values are derived from one source of truth", () => {
    const caps = getCryptoCapabilities();
    expect(caps.envelopeVersion).toBe(CRYPTO_SUITE_REGISTRY.envelopeVersion);
    expect(caps.suites.length).toBe(CRYPTO_SUITE_REGISTRY.suites.length);
  });

  it("reveals no private keys or secrets", () => {
    const json = JSON.stringify(getCryptoCapabilities());
    // No high-entropy blobs (would indicate leaked key/secret material).
    expect(json).not.toMatch(/[0-9a-fA-F]{16,}/);
    // No explicit secret/private markers.
    expect(json.toLowerCase()).not.toContain("secret");
    expect(json.toLowerCase()).not.toContain("private");
    // No algorithm key bytes are exposed (only key *lengths* via keyBits).
    expect(json).not.toContain("-----BEGIN");
  });

  it("returns the same cached object on repeated calls", () => {
    expect(getCryptoCapabilities()).toBe(getCryptoCapabilities());
  });

  it("detects drift between registry and descriptor", () => {
    const caps = getCryptoCapabilities();
    expect(capabilitiesMatchRegistry(caps)).toBe(true);

    const drifted = {
      ...caps,
      envelopeVersion: "v2",
      suites: caps.suites,
      keyFormats: caps.keyFormats,
      limits: caps.limits,
    };
    expect(capabilitiesMatchRegistry(drifted)).toBe(false);
  });

  it("advertises exactly the limits the envelope path enforces (#296)", () => {
    const caps = getCryptoCapabilities();
    expect(caps.limits.maxBodyBytes).toBe(MAX_BODY_BYTES);
    expect(caps.limits.maxAttachments).toBe(MAX_ATTACHMENTS);
    expect(caps.limits.maxAttachmentBytes).toBe(MAX_ATTACHMENT_BYTES);
    expect(CRYPTO_SUITE_REGISTRY.limits.maxBodyBytes).toBe(MAX_BODY_BYTES);
    expect(CRYPTO_SUITE_REGISTRY.limits.maxAttachments).toBe(MAX_ATTACHMENTS);
    expect(CRYPTO_SUITE_REGISTRY.limits.maxAttachmentBytes).toBe(MAX_ATTACHMENT_BYTES);
  });

  it("hardcodes no body or attachment size in capabilities.ts (#296)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../src/services/crypto/capabilities.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).toContain('from "./limits"');
    expect(source).not.toMatch(/65[_]?536|64\s*\*\s*1024/);
    expect(source).not.toMatch(/16[_]?777[_]?216|16\s*\*\s*1024\s*\*\s*1024/);
    expect(source).not.toMatch(/maxAttachments:\s*16\b/);
  });
});
