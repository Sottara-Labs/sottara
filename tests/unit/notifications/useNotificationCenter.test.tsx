// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestBrowserPermission, useNotificationCenter } from "@/features/notifications";
import { defaultPreferences } from "@/features/preferences";
import type { MailboxDescriptor } from "@/lib/api";

const ACTOR = "actor-1";
const STORAGE_KEY = `stealth-notifications:v1:${ACTOR}`;

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

function makeMail(messageId: string): MailboxDescriptor {
  return {
    messageId,
    senderId: "sender-1",
    recipientId: ACTOR,
    status: "delivered",
    createdAt: "2026-10-10T00:00:00.000Z",
    protectedHeaders: {},
    isTombstone: false,
  };
}

function useCenter(mail: MailboxDescriptor[]) {
  return useNotificationCenter({
    actor: ACTOR,
    mail,
    requests: [],
    preferences: defaultPreferences.notifications,
    browserEnabled: false,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestBrowserPermission", () => {
  it("returns unsupported when browser notifications are unavailable", async () => {
    vi.stubGlobal("Notification", undefined);

    await expect(requestBrowserPermission()).resolves.toBe("unsupported");
  });

  it("returns an existing permission without prompting again", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });

    await expect(requestBrowserPermission()).resolves.toBe("denied");
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("useNotificationCenter", () => {
  it("marks all notifications read and persists the result for the actor", () => {
    const storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "mail:m1",
          category: "mail",
          title: "New encrypted mail",
          message: "Open Hush to view it.",
          createdAt: "2026-10-10T00:00:00.000Z",
          read: false,
        },
        {
          id: "request:r1",
          category: "requests",
          title: "New sender request",
          message: "Open Hush to review it.",
          createdAt: "2026-10-10T00:00:00.000Z",
          read: false,
        },
      ]),
    );

    const { result } = renderHook(() => useCenter([]));
    act(() => result.current.markAllRead());

    expect(result.current.notifications.every((item) => item.read)).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(result.current.notifications);
  });

  it("seeds the first live snapshot and notifies only on the next snapshot", () => {
    const storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
    const { result, rerender } = renderHook(({ mail }) => useCenter(mail), {
      initialProps: { mail: [makeMail("m1")] },
    });

    expect(result.current.notifications).toEqual([]);

    rerender({ mail: [makeMail("m1"), makeMail("m2")] });

    expect(result.current.notifications.map((item) => item.id)).toEqual(["mail:m2"]);
  });

  it("fires exactly one desktop notification per arrival under StrictMode", () => {
    const storage = makeStorage();
    const writes = new Map<string, number>();
    const rawSetItem = storage.setItem.bind(storage);
    storage.setItem = (key: string, value: string) => {
      writes.set(key, (writes.get(key) ?? 0) + 1);
      rawSetItem(key, value);
    };
    vi.stubGlobal("localStorage", storage);
    const fired: Array<{ title: string; tag?: string }> = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string, options?: NotificationOptions) {
        fired.push({ title, tag: options?.tag });
      }
    }
    vi.stubGlobal("Notification", FakeNotification);

    const { rerender } = renderHook(
      ({ mail }) =>
        useNotificationCenter({
          actor: ACTOR,
          mail,
          requests: [],
          preferences: defaultPreferences.notifications,
          browserEnabled: true,
        }),
      {
        initialProps: { mail: [makeMail("m1")] },
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      },
    );

    expect(fired).toHaveLength(0);

    rerender({ mail: [makeMail("m1"), makeMail("m2")] });

    expect(fired).toHaveLength(1);
    expect(fired[0]).toEqual({ title: "New encrypted mail", tag: "mail:m2" });
    expect(writes.get(STORAGE_KEY)).toBe(1);
  });
});
