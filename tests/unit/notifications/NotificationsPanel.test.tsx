/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { type ReactNode } from "react";

// Strip framer-motion animations so the DOM updates synchronously
vi.mock("framer-motion", async () => {
  const { Fragment, jsx } = await import("react/jsx-runtime");
  const { forwardRef } = await import("react");
  const MotionDiv = forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
    const { initial, animate, exit, transition, ...rest } = props;
    return jsx("div", { ...rest, ref });
  });
  MotionDiv.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => jsx(Fragment, { children }),
    motion: { div: MotionDiv },
    useReducedMotion: () => true,
  };
});

import { NotificationsPanel } from "../../../src/components/mail/NotificationsPanel";
import type { InAppNotification } from "../../../src/features/notifications";

describe("NotificationsPanel modal accessibility and focus trap (#410)", () => {
  const sampleNotifications: InAppNotification[] = [
    {
      id: "notif-1",
      title: "New Mail Received",
      message: "Encrypted mail from Alice",
      category: "mail",
      read: false,
      createdAt: "2026-06-13T10:00:00Z",
    },
    {
      id: "notif-2",
      title: "Delivery Receipt",
      message: "Message delivered successfully",
      category: "receipts",
      read: true,
      createdAt: "2026-06-13T09:30:00Z",
    },
  ];

  it("declares role='dialog', aria-modal='true', and an accessible name", () => {
    render(
      <NotificationsPanel
        open={true}
        onClose={vi.fn()}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Notifications");
    expect(dialog.getAttribute("aria-labelledby")).toBe("notifications-panel-heading");
    expect(screen.getByText("Notifications").id).toBe("notifications-panel-heading");
  });

  it("moves initial focus into the panel when opened", () => {
    render(
      <NotificationsPanel
        open={true}
        onClose={vi.fn()}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("cycles Tab from the last focusable element back to the first element", () => {
    render(
      <NotificationsPanel
        open={true}
        onClose={vi.fn()}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    expect(focusableElements.length).toBeGreaterThan(1);
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("cycles Shift+Tab from the first focusable element to the last element", () => {
    render(
      <NotificationsPanel
        open={true}
        onClose={vi.fn()}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("asserts focus never escapes the modal dialog during Tab navigation", () => {
    render(
      <div>
        <button type="button" data-testid="outside-mailbox">
          Mailbox
        </button>
        <NotificationsPanel
          open={true}
          onClose={vi.fn()}
          anchorRect={null}
          onViewAll={vi.fn()}
          notifications={sampleNotifications}
          onMarkRead={vi.fn()}
          onMarkAllRead={vi.fn()}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    const outside = screen.getByTestId("outside-mailbox");

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(outside);

    const focusableElements = dialog.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    for (let i = 0; i < focusableElements.length * 2; i++) {
      fireEvent.keyDown(document, { key: "Tab" });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(
      <NotificationsPanel
        open={true}
        onClose={onClose}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger button when closed", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-testid", "notifications-bell-trigger");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <NotificationsPanel
        open={true}
        onClose={vi.fn()}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    rerender(
      <NotificationsPanel
        open={false}
        onClose={vi.fn()}
        anchorRect={null}
        onViewAll={vi.fn()}
        notifications={sampleNotifications}
        onMarkRead={vi.fn()}
        onMarkAllRead={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
