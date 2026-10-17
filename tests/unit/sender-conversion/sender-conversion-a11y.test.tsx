/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React, { type ReactNode } from "react";

// framer-motion drives the dialog shell (AnimatePresence + motion.div). Strip it
// to plain elements so the tests assert DOM contract, not animation behavior.
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

import { SenderConversionDialog } from "../../../src/features/sender-conversion/SenderConversionDialog";
import type { SenderConversionTarget } from "../../../src/features/sender-conversion/types";

describe("SenderConversionDialog focus trap and accessibility (#409)", () => {
  const sampleTarget: SenderConversionTarget = {
    emailId: "email-001",
    sender: "Alice Walker",
    address: "alice@example.com",
    currentPolicy: "verify",
  };

  it("links accessible name via aria-labelledby to the sender title", () => {
    render(
      <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("sender-conversion-title");
    const heading = screen.getByText("Alice Walker");
    expect(heading.id).toBe("sender-conversion-title");
  });

  it("moves initial focus to the first meaningful policy control on open", () => {
    const { container } = render(
      <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const firstPolicy = container.querySelector<HTMLElement>('button[data-sender-policy="allow"]');
    expect(firstPolicy).not.toBeNull();
    expect(document.activeElement).toBe(firstPolicy);
  });

  it("cycles Tab from the last element back to the first element", () => {
    render(
      <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={vi.fn()} />,
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

  it("cycles Shift+Tab from the first element to the last element", () => {
    render(
      <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={vi.fn()} />,
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

  it("asserts focus never escapes the dialog during Tab navigation", () => {
    render(
      <div>
        <button type="button" data-testid="outside-mailbox">
          Mailbox Item
        </button>
        <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={vi.fn()} />
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

  it("invokes onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(
      <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={onClose} />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to previous active element on close", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-testid", "trigger-element");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <SenderConversionDialog target={sampleTarget} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    rerender(<SenderConversionDialog target={null} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("maintains focus trap and moves focus to the Done button in confirmation phase", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <SenderConversionDialog target={sampleTarget} onConfirm={onConfirm} onClose={vi.fn()} />,
    );

    // Pick 'Allow'
    const allowButton = container.querySelector<HTMLElement>('button[data-sender-policy="allow"]');
    expect(allowButton).not.toBeNull();
    fireEvent.click(allowButton!);

    // Click confirm button
    const confirmButton = container.querySelector<HTMLElement>(
      'button[data-sender-conversion-confirm="true"]',
    );
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);

    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Should now be in done phase with Done button focused
    const doneButton = screen.getByRole("button", { name: /Done/i });
    expect(document.activeElement).toBe(doneButton);

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
