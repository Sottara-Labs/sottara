import { useEffect, useRef, useState } from "react";
import type { MailboxDescriptor, UnknownSenderRequest } from "@/lib/api";
import type { NotificationPreferences } from "@/features/preferences";
import {
  createNotification,
  isWithinQuietHours,
  safeBrowserCopy,
  type InAppNotification,
} from "./logic";

const keyFor = (actor: string) => `stealth-notifications:v1:${actor}`;

export function useNotificationCenter({
  actor,
  mail,
  requests,
  preferences,
  browserEnabled,
}: {
  actor: string | null;
  mail: MailboxDescriptor[];
  requests: UnknownSenderRequest[];
  preferences: NotificationPreferences;
  browserEnabled: boolean;
}) {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const seen = useRef(new Set<string>());
  const notificationsRef = useRef<InAppNotification[]>([]);

  useEffect(() => {
    seen.current = new Set();
    if (!actor) {
      notificationsRef.current = [];
      return setNotifications([]);
    }
    try {
      const stored = JSON.parse(localStorage.getItem(keyFor(actor)) ?? "[]") as InAppNotification[];
      notificationsRef.current = stored;
      setNotifications(stored);
      stored.forEach((item) => seen.current.add(item.id));
    } catch {
      localStorage.removeItem(keyFor(actor));
      notificationsRef.current = [];
      setNotifications([]);
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    const incoming = [
      ...mail
        .filter((item) => !item.isTombstone)
        .map((item) => ["mail" as const, `mail:${item.messageId}`, item.createdAt] as const),
      ...requests.map(
        (item) => ["requests" as const, `request:${item.requestId}`, item.createdAt] as const,
      ),
    ];
    // First live snapshot is a baseline, avoiding a notification flood on sign-in.
    if (seen.current.size === 0) {
      incoming.forEach(([, id]) => seen.current.add(id));
      return;
    }
    const additions = incoming.filter(
      ([category, id]) => preferences.categories[category] && !seen.current.has(id),
    );
    if (!additions.length) return;
    additions.forEach(([, id]) => seen.current.add(id));
    // Compute the next list outside the updater: updaters must stay pure, and
    // StrictMode double-invokes them, which would duplicate persistence and
    // desktop notifications.
    const next = additions
      .map(([category, id, createdAt]) => createNotification(id, category, createdAt))
      .concat(notificationsRef.current)
      .slice(0, 100);
    notificationsRef.current = next;
    setNotifications(next);
    localStorage.setItem(keyFor(actor), JSON.stringify(next));
    if (
      browserEnabled &&
      !isWithinQuietHours(new Date(), preferences.quietHours) &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      additions.forEach(([category, id]) => {
        const copy = safeBrowserCopy[category];
        new Notification(copy.title, { body: copy.body, tag: id });
      });
    }
  }, [actor, browserEnabled, mail, preferences, requests]);

  const applyNotifications = (next: InAppNotification[]) => {
    notificationsRef.current = next;
    if (actor) localStorage.setItem(keyFor(actor), JSON.stringify(next));
    setNotifications(next);
  };
  return {
    notifications,
    markRead: (id: string) =>
      applyNotifications(
        notificationsRef.current.map((item) => (item.id === id ? { ...item, read: true } : item)),
      ),
    markAllRead: () =>
      applyNotifications(notificationsRef.current.map((item) => ({ ...item, read: true }))),
  };
}

export async function requestBrowserPermission() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  return Notification.permission === "default"
    ? Notification.requestPermission()
    : Notification.permission;
}
