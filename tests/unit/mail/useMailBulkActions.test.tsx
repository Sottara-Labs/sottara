// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Email } from "@/components/mail/data";
import { useMailBulkActions } from "@/features/mail/useMailBulkActions";
import type { MailMutationResult } from "@/features/mail/useMailSource";

function email(id: string, overrides: Partial<Email> = {}): Email {
  return {
    id,
    from: `${id} Sender`,
    email: `${id}@example.com`,
    subject: `Subject ${id}`,
    preview: "Preview",
    body: "Body",
    time: "10:00 AM",
    unread: true,
    starred: false,
    folder: "inbox",
    avatarColor: "#000000",
    ...overrides,
  };
}

describe("useMailBulkActions", () => {
  it("applies an action to every selected message and clears after success", async () => {
    const selected = Array.from({ length: 105 }, (_, index) => email(`mail-${index}`));
    const updateEmail = vi.fn();
    const onClearSelection = vi.fn();
    const onToast = vi.fn();
    const { result } = renderHook(() =>
      useMailBulkActions({
        selectedEmails: selected,
        updateEmail,
        trashEmail: vi.fn(async () => ({ ok: true }) satisfies MailMutationResult),
        onToast,
        onClearSelection,
        paceMs: 0,
      }),
    );

    await act(async () => {
      await result.current.runBulkAction({ action: "star", value: true });
    });

    expect(updateEmail).toHaveBeenCalledTimes(selected.length);
    for (const mail of selected) {
      expect(updateEmail).toHaveBeenCalledWith(mail.id, { starred: true });
    }
    expect(result.current.bulkProgress).toMatchObject({
      action: "star",
      total: selected.length,
      completed: selected.length,
      failures: [],
    });
    expect(onClearSelection).toHaveBeenCalledOnce();
    expect(onToast).toHaveBeenCalledWith("Star · 105 selected complete");
  });

  it("reports partial failures and keeps the selection available for retry", async () => {
    const selected = [email("one"), email("two"), email("three")];
    const mutateMailbox = vi.fn(
      async (mail: Email): Promise<MailMutationResult> =>
        mail.id === "two" ? { ok: false, reason: "network unavailable" } : { ok: true },
    );
    const onClearSelection = vi.fn();
    const onToast = vi.fn();
    const { result } = renderHook(() =>
      useMailBulkActions({
        selectedEmails: selected,
        updateEmail: vi.fn(),
        trashEmail: vi.fn(async () => ({ ok: true }) satisfies MailMutationResult),
        mutateMailbox,
        onToast,
        onClearSelection,
        paceMs: 0,
      }),
    );

    await act(async () => {
      await result.current.runBulkAction({ action: "star", value: true });
    });

    await waitFor(() =>
      expect(result.current.bulkFailures).toEqual([
        { id: "two", subject: "Subject two", reason: "network unavailable" },
      ]),
    );
    expect(mutateMailbox).toHaveBeenCalledTimes(selected.length);
    expect(result.current.bulkProgress).toMatchObject({
      completed: selected.length,
      failures: [{ id: "two", subject: "Subject two", reason: "network unavailable" }],
    });
    expect(onClearSelection).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("1 selected message could not be updated", {
      tone: "danger",
    });
  });

  it("keeps invalid targets in the failure report without claiming success", async () => {
    const selected = [email("inbox"), email("archived", { folder: "archive" })];
    const onToast = vi.fn();
    const onClearSelection = vi.fn();
    const { result } = renderHook(() =>
      useMailBulkActions({
        selectedEmails: selected,
        updateEmail: vi.fn(),
        trashEmail: vi.fn(async () => ({ ok: true }) satisfies MailMutationResult),
        onToast,
        onClearSelection,
        paceMs: 0,
      }),
    );

    await act(async () => {
      await result.current.runBulkAction({ action: "archive" });
    });

    expect(result.current.bulkFailures).toEqual([
      { id: "archived", subject: "Subject archived", reason: "Already archived." },
    ]);
    expect(onClearSelection).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("1 selected message could not be updated", {
      tone: "danger",
    });
  });
});
