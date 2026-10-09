import { describe, expect, it } from "vitest";

import { createQuarantineRecord } from "@/features/mail/quarantine";

describe("createQuarantineRecord reason mapping", () => {
  it("maps version error to version_error", () => {
    const byCode = createQuarantineRecord({ code: "crypto_version_error" });
    expect(byCode.reasonCode).toBe("version_error");
    expect(byCode.userHeadline).toBe("Unsupported Protocol Version");

    const byMsg = createQuarantineRecord(new Error("unsupported version 3"));
    expect(byMsg.reasonCode).toBe("version_error");
    expect(byMsg.userHeadline).toBe("Unsupported Protocol Version");
  });

  it("maps signature error to signature_error", () => {
    const rec = createQuarantineRecord(new Error("invalid signature on payload"));
    expect(rec.reasonCode).toBe("signature_error");
    expect(rec.userHeadline).toBe("Sender Signature Verification Failed");
  });

  it("maps integrity / mac errors to integrity_error", () => {
    const byCode = createQuarantineRecord({ code: "crypto_integrity_error" });
    expect(byCode.reasonCode).toBe("integrity_error");
    expect(byCode.userHeadline).toBe("Integrity Check Failed");

    const byMac = createQuarantineRecord(new Error("mac tag mismatch"));
    expect(byMac.reasonCode).toBe("integrity_error");

    const byAuthTag = createQuarantineRecord(new Error("auth tag invalid"));
    expect(byAuthTag.reasonCode).toBe("integrity_error");

    const byCommitment = createQuarantineRecord(new Error("commitment failed"));
    expect(byCommitment.reasonCode).toBe("integrity_error");
  });

  it("maps decryption errors to decryption_error", () => {
    const byCode = createQuarantineRecord({ code: "crypto_decryption_error" });
    expect(byCode.reasonCode).toBe("decryption_error");
    expect(byCode.userHeadline).toBe("Decryption Key Unavailable");

    const byMsg = createQuarantineRecord(new Error("payload decryption failed"));
    expect(byMsg.reasonCode).toBe("decryption_error");
  });

  it("maps recipient binding errors to recipient_mismatch", () => {
    const rec = createQuarantineRecord(new Error("recipient binding does not match"));
    expect(rec.reasonCode).toBe("recipient_mismatch");
    expect(rec.userHeadline).toBe("Recipient Binding Mismatch");
  });

  it("maps timestamp errors to timestamp_error", () => {
    const rec = createQuarantineRecord(new Error("envelope timestamp expired"));
    expect(rec.reasonCode).toBe("timestamp_error");
    expect(rec.userHeadline).toBe("Timestamp Out of Bounds");
  });

  it("maps schema errors to schema_error", () => {
    const byCode = createQuarantineRecord({ code: "crypto_validation_error" });
    expect(byCode.reasonCode).toBe("schema_error");
    expect(byCode.userHeadline).toBe("Envelope Schema Error");

    const byMsg = createQuarantineRecord(new Error("schema validation failed"));
    expect(byMsg.reasonCode).toBe("schema_error");
  });

  it("maps unrecognized or opaque error to validation_error fallback", () => {
    const rec = createQuarantineRecord(new Error("unknown socket dropped"));
    expect(rec.reasonCode).toBe("validation_error");
    expect(rec.userHeadline).toBe("Quarantined Envelope");
    expect(rec.userDetail).toBe(
      "The message failed security and integrity checks and was isolated.",
    );

    const stringErr = createQuarantineRecord("unexpected string error");
    expect(stringErr.reasonCode).toBe("validation_error");
    expect(stringErr.userHeadline).toBe("Quarantined Envelope");
  });

  it("generates diagnosticId matching quar-xxxx-xxxx format and passes through sender/recipient", () => {
    const sender = "alice@betasmail.com";
    const recipient = "bob@betasmail.com";
    const rec = createQuarantineRecord(new Error("some error"), sender, recipient);

    expect(rec.diagnosticId).toMatch(/^quar-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(rec.sender).toBe(sender);
    expect(rec.recipient).toBe(recipient);
    expect(rec.quarantinedAt).toBeDefined();
  });
});
