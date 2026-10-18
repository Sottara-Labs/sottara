import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readDoc(name: string): string {
  return readFileSync(join(process.cwd(), name), "utf-8");
}

describe("implementation notes match the shipped code", () => {
  it("postage quote notes cite normalizeValidationError, not error.flatten()", () => {
    const doc = readDoc("POSTAGE_QUOTE_VALIDATION_IMPLEMENTATION.md");
    expect(doc).not.toContain("error.flatten()");
    expect(doc).toContain("normalizeValidationError(error)");
  });

  it("settlement idempotency notes cite withIdempotency, not checkIdempotency", () => {
    const doc = readDoc("SETTLEMENT_IDEMPOTENCY_IMPLEMENTATION.md");
    expect(doc).not.toContain("checkIdempotency(");
    expect(doc).toContain("withIdempotency(");
    expect(doc).toContain("@/server/api/idempotency-service");
  });

  it("recipient resolution notes do not describe S-prefixed addresses as a recipient format", () => {
    const doc = readDoc("RECIPIENT_RESOLUTION_IMPLEMENTATION.md");
    expect(doc).not.toMatch(/S-prefix, 56 chars/);
    expect(doc).toMatch(/S-prefixed secret keys are rejected/);
  });
});
