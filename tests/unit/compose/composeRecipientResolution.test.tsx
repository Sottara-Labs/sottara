/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Compose } from "@/components/mail/Compose";
import { resolveRecipients } from "@/features/compose/recipientResolver";

vi.mock("@/features/compose/recipientResolver", async () => {
  const actual = await vi.importActual<any>("@/features/compose/recipientResolver");
  return {
    ...actual,
    resolveRecipients: vi.fn(),
  };
});

vi.mock("@/features/compose/draftApi", () => ({
  createDraft: vi.fn().mockResolvedValue({ id: "draft-1", version: 1 }),
  updateDraft: vi.fn().mockResolvedValue({ id: "draft-1", version: 2 }),
  deleteDraft: vi.fn().mockResolvedValue(undefined),
  DraftConflictError: class extends Error {},
}));

vi.mock("@/features/compose/usePostageQuote", () => ({
  usePostageQuote: vi.fn().mockReturnValue({ status: "idle" }),
}));

vi.mock("@/features/onboarding/useFreighter", () => ({
  useFreighter: vi.fn().mockReturnValue({ state: { status: "idle" }, connect: vi.fn() }),
}));

vi.mock("@/services/stellar/account-signer", () => ({
  resolveAccountSenderAddress: vi.fn().mockResolvedValue("GACCOUNT"),
}));

vi.mock("@/components/mail/PostageBalanceBadge", () => ({
  PostageBalanceBadge: () => null,
}));

describe("Compose recipient resolution effect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers exactly one resolution pass when typing one recipient", async () => {
    vi.mocked(resolveRecipients).mockResolvedValue([
      {
        address: "alice*stellar.org",
        state: "verified",
        postage: "ready",
        message: "Verified recipient",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    ]);

    render(<Compose open={true} onClose={vi.fn()} />);

    const toInput = screen.getByLabelText("To");

    act(() => {
      fireEvent.change(toInput, { target: { value: "alice*stellar.org" } });
    });

    // Advance past the 300ms debounce
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(resolveRecipients).toHaveBeenCalledTimes(1);

    // Advance more time — no repeated calls should be triggered by resolved state update
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(resolveRecipients).toHaveBeenCalledTimes(1);
  });

  it("does not re-resolve when resolved length is unchanged and inputs have not changed", async () => {
    vi.mocked(resolveRecipients).mockResolvedValue([
      {
        address: "alice*stellar.org",
        state: "verified",
        postage: "ready",
        message: "Verified recipient",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    ]);

    const { rerender } = render(<Compose open={true} onClose={vi.fn()} />);

    const toInput = screen.getByLabelText("To");
    act(() => {
      fireEvent.change(toInput, { target: { value: "alice*stellar.org" } });
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(resolveRecipients).toHaveBeenCalledTimes(1);

    // Parent re-renders with same inputs
    rerender(<Compose open={true} onClose={vi.fn()} />);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Still exactly one resolution pass
    expect(resolveRecipients).toHaveBeenCalledTimes(1);
  });
});
