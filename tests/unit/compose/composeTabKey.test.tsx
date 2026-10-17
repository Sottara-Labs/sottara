/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Compose } from "@/components/mail/Compose";

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

describe("Compose keyboard accessibility", () => {
  it("does not prevent the Tab key in the message body by default", async () => {
    await act(async () => {
      render(<Compose open={true} onClose={vi.fn()} />);
    });

    const textarea = screen.getByPlaceholderText(/Write your message…/i);
    textarea.focus();

    expect(document.activeElement).toBe(textarea);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });

    const notCancelled = textarea.dispatchEvent(event);

    expect(notCancelled).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("provides an accessible button to insert the AI suggestion", () => {
    render(<Compose open={true} onClose={vi.fn()} />);

    const textarea = screen.getByPlaceholderText(/Write your message…/i) as HTMLTextAreaElement;
    const insertBtn = screen.getByRole("button", { name: /Insert suggestion/i });

    fireEvent.click(insertBtn);

    expect(textarea.value).toContain("Confirming Friday's review");
  });
});
