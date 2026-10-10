// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Email } from "../../../src/components/mail/data";
import type { CalendarEvent } from "../../../src/features/calendar";
import { useMailCommands } from "../../../src/features/mail/useMailCommands";

const email: Email = {
  id: "mail-1",
  from: "Alice Smith",
  email: "alice@example.com",
  subject: "Hello",
  preview: "A preview",
  body: "A body",
  time: "10:00 AM",
  unread: true,
  starred: false,
  folder: "inbox",
  avatarColor: "#000000",
  labels: ["Paid"],
  event: {
    title: "Planning",
    month: "Jan",
    day: "1",
    cadence: "Once",
    time: "10:00",
    location: "Online",
    note: "Notes",
    days: [],
  },
};

const calendarEvent: CalendarEvent = {
  id: "event-1",
  title: "Planning",
  date: "2026-01-01",
  time: "10:00",
  endTime: "11:00",
  location: "Online",
  note: "Notes",
  calendarId: "work",
  cadence: "Once",
  sourceEmailId: email.id,
  response: "maybe",
  reminder: "10 minutes before",
};

function createProps() {
  return {
    selected: email,
    minimumPostage: "25",
    calendarEvents: [calendarEvent],
    openCompose: vi.fn(),
    openCalendar: vi.fn(),
    openSettings: vi.fn(),
    openShortcuts: vi.fn(),
    togglePalette: vi.fn(),
    goFolder: vi.fn(),
    archive: vi.fn(),
    applySender: vi.fn(),
    quickSnooze: vi.fn(),
    showToast: vi.fn(),
    updateEmail: vi.fn(),
    openProofInspector: vi.fn(),
  };
}

describe("useMailCommands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes app and navigation commands to their callbacks", () => {
    const props = createProps();
    const { result } = renderHook(() => useMailCommands(props));

    act(() => {
      result.current.runCommand("compose");
      result.current.runCommand("open-settings");
      result.current.runCommand("open-shortcuts");
      result.current.runCommand("go-inbox");
      result.current.runCommand("go-starred");
      result.current.runCommand("go-sent");
    });

    expect(props.openCompose).toHaveBeenCalledOnce();
    expect(props.openSettings).toHaveBeenCalledOnce();
    expect(props.openShortcuts).toHaveBeenCalledOnce();
    expect(props.goFolder).toHaveBeenNthCalledWith(1, "inbox");
    expect(props.goFolder).toHaveBeenNthCalledWith(2, "starred");
    expect(props.goFolder).toHaveBeenNthCalledWith(3, "sent");
  });

  it("passes the selected email to message and sender actions", () => {
    const props = createProps();
    const { result } = renderHook(() => useMailCommands(props));

    act(() => {
      result.current.runCommand("archive-thread");
      result.current.runCommand("approve-sender");
      result.current.runCommand("block-sender");
    });

    expect(props.archive).toHaveBeenCalledWith(email);
    expect(props.applySender).toHaveBeenNthCalledWith(1, "allow", email);
    expect(props.applySender).toHaveBeenNthCalledWith(2, "block", email);
  });

  it("uses the matching calendar event and exposes the postage quote", () => {
    const props = createProps();
    const { result } = renderHook(() => useMailCommands(props));

    act(() => {
      result.current.runCommand("open-calendar");
      result.current.runCommand("quote-postage");
    });

    expect(props.openCalendar).toHaveBeenCalledWith(calendarEvent.id);
    expect(props.showToast).toHaveBeenCalledWith("Minimum postage for Alice Smith is 25 XLM");
  });

  it("updates delivery state and refunds postage for the selected email", () => {
    const props = createProps();
    const { result } = renderHook(() => useMailCommands(props));

    act(() => {
      result.current.runCommand("settle-delivery");
      result.current.runCommand("refund-postage");
    });

    expect(props.updateEmail).toHaveBeenNthCalledWith(1, email.id, {
      receiptState: "sent",
      folder: "receipts",
    });
    expect(props.updateEmail).toHaveBeenNthCalledWith(2, email.id, {
      folder: "spam",
      labels: ["Paid", "Refunded"],
    });
    expect(props.showToast).toHaveBeenCalledWith('Delivery settled for "Hello"');
  });

  it("supports proof inspection and an explicit override email", () => {
    const props = createProps();
    const override = { ...email, id: "override", subject: "Override" };
    const { result } = renderHook(() => useMailCommands(props));

    act(() => {
      result.current.runCommand("open-proof-inspector");
      result.current.runCommand("inspect-proof", override);
    });

    expect(props.openProofInspector).toHaveBeenNthCalledWith(1, "");
    expect(props.openProofInspector).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^0xoverride+.*d8c7e9$/),
    );
  });

  it("routes shortcut actions and global keyboard shortcuts", () => {
    const props = createProps();
    const { result, unmount } = renderHook(() => useMailCommands(props));

    act(() => {
      result.current.runShortcutAction("snooze-thread");
      result.current.runShortcutAction("open-palette");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
    });

    expect(props.quickSnooze).toHaveBeenCalledWith(email);
    expect(props.togglePalette).toHaveBeenCalledOnce();
    expect(props.openCompose).toHaveBeenCalledOnce();

    unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
    expect(props.openCompose).toHaveBeenCalledOnce();
  });
});
