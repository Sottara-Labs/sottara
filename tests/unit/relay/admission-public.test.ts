import { describe, expect, it } from "vitest";

import type { AdmissionEvidence, AdmissionReason } from "@/server/api/domain";
import { ADMISSION_REASON_MESSAGES } from "@/server/api/policy-admission";
import { admissionDenialError, publicAdmissionDecision } from "@/services/relay/admission";

function createMockEvidence(
  reason: AdmissionReason = "sender_blocked",
  overrides: Partial<AdmissionEvidence> & Record<string, unknown> = {},
): AdmissionEvidence {
  return {
    allowed: false,
    disposition: "blocked",
    reason,
    rule: "block",
    policyVersion: 2,
    requiredPostage: "1000",
    source: "chain",
    evaluatedAt: "2026-10-10T08:00:00.000Z",
    ...overrides,
  } as AdmissionEvidence;
}

describe("publicAdmissionDecision", () => {
  it("omits internal evaluation fields and includes strictly documented fields", () => {
    const evidence = createMockEvidence("sender_blocked", {
      evaluatedAt: "2026-10-10T08:00:00.000Z",
      internalSnapshotId: "snapshot-1234",
      rawChainState: "0xdeadbeef",
      ownerAccount: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    });

    const decision = publicAdmissionDecision(evidence);

    expect(decision).toEqual({
      allowed: false,
      disposition: "blocked",
      reason: "sender_blocked",
      policyVersion: 2,
      requiredPostage: "1000",
      rule: "block",
      source: "chain",
      message: ADMISSION_REASON_MESSAGES.sender_blocked,
    });

    const decisionKeys = Object.keys(decision).sort();
    expect(decisionKeys).toEqual([
      "allowed",
      "disposition",
      "message",
      "policyVersion",
      "reason",
      "requiredPostage",
      "rule",
      "source",
    ]);

    expect((decision as Record<string, unknown>).evaluatedAt).toBeUndefined();
    expect((decision as Record<string, unknown>).internalSnapshotId).toBeUndefined();
    expect((decision as Record<string, unknown>).rawChainState).toBeUndefined();
    expect((decision as Record<string, unknown>).ownerAccount).toBeUndefined();
  });
});

describe("admissionDenialError", () => {
  it("maps insufficient_postage to HTTP 422 with code insufficient_postage", () => {
    const evidence = createMockEvidence("insufficient_postage", {
      requiredPostage: "5000",
      disposition: "priced",
    });

    const err = admissionDenialError(evidence);

    expect(err.status).toBe(422);
    expect(err.code).toBe("insufficient_postage");
    expect(err.message).toBe(ADMISSION_REASON_MESSAGES.insufficient_postage);
    expect(err.details).toEqual(publicAdmissionDecision(evidence));
  });

  const otherDenialReasons: AdmissionReason[] = [
    "sender_blocked",
    "unknown_senders_disabled",
    "verification_required",
    "receipt_required",
  ];

  it.each(otherDenialReasons)("maps denial reason %s to HTTP 403 with code forbidden", (reason) => {
    const evidence = createMockEvidence(reason);
    const err = admissionDenialError(evidence);

    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
    expect(err.message).toBe(ADMISSION_REASON_MESSAGES[reason]);
    expect(err.details).toEqual(publicAdmissionDecision(evidence));
  });

  it("never leaks raw chain error text in the error message", () => {
    const rawErrorEvidence = createMockEvidence("sender_blocked", {
      chainError: "Fatal: HostError: Error(Contract, #123) in Soroban VM",
      rawError: "Stellar Horizon RPC execution failure code -32603",
    });

    const err = admissionDenialError(rawErrorEvidence);

    expect(err.message).toBe(ADMISSION_REASON_MESSAGES.sender_blocked);
    expect(err.message).not.toContain("HostError");
    expect(err.message).not.toContain("Soroban");
    expect(err.message).not.toContain("RPC");
  });
});
