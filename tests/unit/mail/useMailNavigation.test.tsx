// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Email, MailFolder } from "../../../src/components/mail/data";
import { useMailNavigation } from "../../../src/features/mail/useMailNavigation";

function email(id: string, folder: Email["folder"], labels: string[] = []): Email {
  return {
    id,
    from: id,
    email: `${id}@example.com`,
    subject: id,
    preview: id,
    body: id,
    time: "10:00 AM",
    unread: false,
    starred: false,
    folder,
    labels,
    attachments: [],
    avatarColor: "#000000",
  };
}

const emails = [
  email("inbox-1", "inbox"),
  email("inbox-2", "inbox", ["Later"]),
  email("sent-1", "sent"),
];

describe("useMailNavigation", () => {
  it("derives the initial visible rows, counts, and selection", async () => {
    const { result } = renderHook(() => useMailNavigation(emails));

    await waitFor(() => expect(result.current.selectedId).toBe("inbox-1"));
    expect(result.current.folder).toBe("inbox");
    expect(result.current.visibleEmails.map((mail) => mail.id)).toEqual(["inbox-1", "inbox-2"]);
    expect(result.current.selectedEmails).toEqual([]);
    expect(result.current.folderCounts.inbox).toBe(2);
    expect(result.current.folderCounts.sent).toBe(1);
  });

  it("changes folders and moves the selection to the first visible message", async () => {
    const { result } = renderHook(() => useMailNavigation(emails));
    await waitFor(() => expect(result.current.selectedId).toBe("inbox-1"));

    act(() => result.current.selectFolder("sent"));

    await waitFor(() => expect(result.current.selectedId).toBe("sent-1"));
    expect(result.current.folder).toBe("sent");
    expect(result.current.mobileView).toBe("list");
    expect(result.current.visibleEmails.map((mail) => mail.id)).toEqual(["sent-1"]);
  });

  it("opens a message, resets filters, and clears bulk selection", async () => {
    const { result } = renderHook(() => useMailNavigation(emails));
    await waitFor(() => expect(result.current.selectedId).toBe("inbox-1"));

    act(() => {
      result.current.setFilters({ unreadOnly: true, hasAttachments: true, dateRange: "week" });
      result.current.setSelectedIds(["inbox-1"]);
      result.current.openMessage(emails[1]);
    });

    expect(result.current.folder).toBe("inbox");
    expect(result.current.selectedId).toBe("inbox-2");
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.filters).toEqual({
      unreadOnly: false,
      hasAttachments: false,
      dateRange: "all",
    });
    expect(result.current.mobileView).toBe("reader");
  });

  it("selects the first message in a custom label folder and tracks selected rows", async () => {
    const { result } = renderHook(() => useMailNavigation(emails));
    await waitFor(() => expect(result.current.selectedId).toBe("inbox-1"));

    act(() => {
      result.current.setCustomFolder("later");
    });

    await waitFor(() => expect(result.current.selectedId).toBe("inbox-2"));
    expect(result.current.customFolder).toBe("later");
    expect(result.current.visibleEmails.map((mail) => mail.id)).toEqual(["inbox-2"]);

    act(() => result.current.setSelectedIds(["inbox-2", "sent-1"]));
    expect(result.current.selectedEmails.map((mail) => mail.id)).toEqual(["inbox-2"]);
  });

  it("uses live folder counts when supplied", () => {
    const liveCounts = Object.fromEntries(
      [
        "all",
        "inbox",
        "priority",
        "snoozed",
        "verified",
        "pending",
        "requests",
        "encrypted",
        "receipts",
        "starred",
        "sent",
        "outbox",
        "drafts",
        "scheduled",
        "archive",
        "spam",
        "trash",
      ].map((folder) => [folder, folder === "inbox" ? 9 : folder === "sent" ? 4 : 0]),
    ) as Record<MailFolder, number>;
    const { result } = renderHook(() => useMailNavigation(emails, liveCounts));

    expect(result.current.folderCounts).toBe(liveCounts);
    expect(result.current.folderCounts.inbox).toBe(9);
    expect(result.current.folderCounts.sent).toBe(4);
  });
});
