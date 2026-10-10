import { describe, expect, it } from "vitest";

import { createQuarantineRecord } from "@/features/mail/quarantine";

describe("createQuarantineRecord", () => {
  it("prioritizes recipient binding over a generic key mention", () => {
    const result = createQuarantineRecord(
      new Error("Recipient binding check failed against the recipient key"),
    );

    expect(result.reasonCode).toBe("recipient_mismatch");
    expect(result.userHeadline).toBe("Recipient Binding Mismatch");
  });

  it("keeps ordinary decryption failures classified as decryption errors", () => {
    const result = createQuarantineRecord(new Error("Decryption failed: no key available"));

    expect(result.reasonCode).toBe("decryption_error");
    expect(result.userHeadline).toBe("Decryption Key Unavailable");
  });
});
