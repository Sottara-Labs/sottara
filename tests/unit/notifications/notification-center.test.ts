/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MailboxDescriptor, UnknownSenderRequest } from "@/lib/api";
import type { NotificationPreferences } from "@/features/preferences";
import {
  requestBrowserPermission,
  useNotificationCenter,
} from "@/features/notifications/useNotificationCenter";

const actor = "test-actor";
const storageKey = `stealth-notifications:v1:${actor}`;

const preferences: NotificationPreferences = {
  categories: { mail: true, requests: true, failures: true, receipts: true },
  quietHours: { enabled: false, start: "00:00", end: "00:00" },
};

function mailItem(messageId: string): MailboxDescriptor {
  return {
    messageId,
    senderId: "sender-1",
    recipientId: actor,
    status: "delivered",
    createdAt: "2026-10-01T00:00:00.000Z",
    protectedHeaders: {},
    isTombstone: false,
  };
}

const baseProps = {
  actor,
  mail: [] as MailboxDescriptor[],
  requests: [] as UnknownSenderRequest[],
  preferences,
  browserEnabled: false,
};

function stubNotification(permission: string, requestPermission?: () => Promise<string>) {
  (globalThis as Record<string, unknown>).Notification = {
    permission,
    requestPermission: requestPermission ?? vi.fn(),
  };
}

function clearNotificationStub() {
  delete (globalThis as Record<string, unknown>).Notification;
}

beforeEach(() => {
  localStorage.clear();
  clearNotificationStub();
});

describe("requestBrowserPermission", () => {
  it("returns unsupported when the Notification API is absent", async () => {
    clearNotificationStub();
    await expect(requestBrowserPermission()).resolves.toBe("unsupported");
  });

  it("returns the existing permission without prompting when already decided", async () => {
    const requestPermission = vi.fn();
    stubNotification("granted", requestPermission);

    await expect(requestBrowserPermission()).resolves.toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission when the current state is default", async () => {
    const requestPermission = vi.fn().mockResolvedValue("denied");
    stubNotification("default", requestPermission);

    await expect(requestBrowserPermission()).resolves.toBe("denied");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("useNotificationCenter", () => {
  it("treats the first snapshot as a baseline and does not notify", () => {
    const { result } = renderHook((props) => useNotificationCenter(props), {
      initialProps: { ...baseProps, mail: [mailItem("m1"), mailItem("m2")] },
    });

    expect(result.current.notifications).toEqual([]);
  });

  it("creates and persists notifications for mail arriving after the baseline", () => {
    const { result, rerender } = renderHook((props) => useNotificationCenter(props), {
      initialProps: { ...baseProps, mail: [mailItem("m1")] },
    });
    expect(result.current.notifications).toEqual([]);

    rerender({ ...baseProps, mail: [mailItem("m1"), mailItem("m2")] });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]).toMatchObject({
      id: "mail:m2",
      category: "mail",
      read: false,
    });

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("mail:m2");
  });

  it("surfaces notifications that arrive in the first poll when nothing was persisted", () => {
    const { result, rerender } = renderHook((props) => useNotificationCenter(props), {
      initialProps: { ...baseProps, mail: [] as MailboxDescriptor[] },
    });

    expect(result.current.notifications).toEqual([]);

    rerender({ ...baseProps, mail: [mailItem("m1")] });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]).toMatchObject({
      id: "mail:m1",
      category: "mail",
      read: false,
    });

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("mail:m1");
  });

  it("markAllRead marks every notification read and persists the state", () => {
    const { result, rerender } = renderHook((props) => useNotificationCenter(props), {
      initialProps: { ...baseProps, mail: [mailItem("m1")] },
    });
    rerender({ ...baseProps, mail: [mailItem("m1"), mailItem("m2"), mailItem("m3")] });
    expect(result.current.notifications).toHaveLength(2);

    act(() => {
      result.current.markAllRead();
    });

    expect(result.current.notifications.every((item) => item.read)).toBe(true);
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Array<{
      read: boolean;
    }>;
    expect(stored).toHaveLength(2);
    expect(stored.every((item) => item.read)).toBe(true);
  });

  it("restores persisted notifications when the actor mounts", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "mail:m9",
          category: "mail",
          title: "New encrypted mail",
          message: "Open Hush to view it.",
          createdAt: "2026-10-01T00:00:00.000Z",
          read: false,
        },
      ]),
    );

    const { result } = renderHook((props) => useNotificationCenter(props), {
      initialProps: baseProps,
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe("mail:m9");
  });
});
