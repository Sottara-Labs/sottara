// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { EmailList } from "../../../src/components/mail/EmailList";
import type { Email, MailFilters } from "../../../src/components/mail/data";

const defaultFilters: MailFilters = {
  readStatus: "all",
  hasAttachments: null,
  dateRange: "all",
  importance: "all",
  searchQuery: "",
};

const sampleEmails: Email[] = [
  {
    id: "mail-1",
    from: "Alice",
    email: "alice@example.com",
    subject: "Hello",
    preview: "Preview Alice",
    body: "Body Alice",
    time: "10:00 AM",
    unread: true,
    starred: false,
    folder: "inbox",
    avatarColor: "#123456",
  },
  {
    id: "mail-2",
    from: "Bob",
    email: "bob@example.com",
    subject: "World",
    preview: "Preview Bob",
    body: "Body Bob",
    time: "11:00 AM",
    unread: false,
    starred: true,
    folder: "inbox",
    avatarColor: "#654321",
  },
];

describe("EmailList keydown listener registration (Issue #398)", () => {
  it("registers the keydown listener once and does not re-register across renders", () => {
    const addEventListenerSpy = vi.spyOn(HTMLUListElement.prototype, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(HTMLUListElement.prototype, "removeEventListener");

    const onSelect = vi.fn();

    function TestWrapper() {
      const [count, setCount] = useState(0);
      const [selectedId, setSelectedId] = useState<string | null>("mail-1");

      return (
        <div>
          <button data-testid="re-render-btn" onClick={() => setCount((c) => c + 1)}>
            Render {count}
          </button>
          <button data-testid="change-selection-btn" onClick={() => setSelectedId("mail-2")}>
            Select 2
          </button>
          <EmailList
            emails={sampleEmails}
            selectedId={selectedId}
            onSelect={onSelect}
            folder="inbox"
            filters={defaultFilters}
            showAvatars={true}
          />
        </div>
      );
    }

    const { getByTestId, unmount } = render(<TestWrapper />);

    // Initial mount: keydown should have been added once
    const keydownAddsInitial = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;
    const keydownRemovesInitial = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;

    expect(keydownAddsInitial).toBe(1);
    expect(keydownRemovesInitial).toBe(0);

    // Trigger re-render via unrelated state change
    act(() => {
      getByTestId("re-render-btn").click();
    });

    const keydownAddsAfterRerender = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;
    const keydownRemovesAfterRerender = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;

    // Listener count should remain strictly constant
    expect(keydownAddsAfterRerender).toBe(1);
    expect(keydownRemovesAfterRerender).toBe(0);

    // Trigger state change of selectedId
    act(() => {
      getByTestId("change-selection-btn").click();
    });

    const keydownAddsAfterSelection = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;
    const keydownRemovesAfterSelection = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;

    expect(keydownAddsAfterSelection).toBe(1);
    expect(keydownRemovesAfterSelection).toBe(0);

    // On unmount, the single listener should be cleaned up
    unmount();

    const keydownRemovesAfterUnmount = removeEventListenerSpy.mock.calls.filter(
      (call) => call[0] === "keydown",
    ).length;
    expect(keydownRemovesAfterUnmount).toBe(1);

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("handles key events using latest selectedId and movePicker refs", async () => {
    const onSelect = vi.fn();

    function TestWrapper() {
      const [selectedId, setSelectedId] = useState<string | null>("mail-1");

      return (
        <div>
          <button data-testid="select-mail-2" onClick={() => setSelectedId("mail-2")}>
            Select 2
          </button>
          <EmailList
            emails={sampleEmails}
            selectedId={selectedId}
            onSelect={onSelect}
            folder="inbox"
            filters={defaultFilters}
            showAvatars={true}
          />
        </div>
      );
    }

    const { getByTestId, getByRole, queryByText } = render(<TestWrapper />);
    const listElement = getByRole("list", { name: "Inbox conversations" });

    // Ensure move picker is initially closed
    expect(queryByText("Esc to cancel")).toBeNull();

    // Change selection to mail-2
    act(() => {
      getByTestId("select-mail-2").click();
    });

    // Press 'm' on listElement
    act(() => {
      listElement.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    });

    // Move picker should now be open
    expect(queryByText("Esc to cancel")).not.toBeNull();

    // Press 'Escape' on listElement to dismiss
    act(() => {
      listElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    // Move picker should now be dismissed (await AnimatePresence exit transition)
    await waitFor(() => {
      expect(queryByText("Esc to cancel")).toBeNull();
    });
  });
});
