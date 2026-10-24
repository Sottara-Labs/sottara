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

import { CommandPalette } from "../../../src/features/command-palette/CommandPalette";
import type { Email, MailLocation } from "../../../src/components/mail/data";
import type { CommandContext } from "../../../src/features/command-palette/types";

describe("CommandPalette assistive technology and combobox accessibility (#411)", () => {
  const sampleEmail: Email = {
    id: "mail-1",
    from: "Alice",
    email: "alice@example.com",
    subject: "Security Advisory",
    preview: "Please read...",
    body: "Details...",
    time: "10:00 AM",
    unread: true,
    starred: false,
    folder: "inbox" as MailLocation,
    avatarColor: "#000",
  };

  const sampleContext: CommandContext = {
    email: sampleEmail,
    folder: "inbox",
  };

  it("exposes the input as a combobox with an accessible name and listbox controls", () => {
    render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        context={sampleContext}
        emails={[sampleEmail]}
        onRunCommand={vi.fn()}
        onNavigate={vi.fn()}
        onSelectEmail={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const combobox = screen.getByRole("combobox");
    expect(combobox).toBeDefined();
    expect(combobox.getAttribute("aria-label")).toBe("Command palette search");
    expect(combobox.getAttribute("aria-autocomplete")).toBe("list");
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    expect(combobox.getAttribute("aria-controls")).toBe("command-palette-listbox");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeDefined();
    expect(listbox.id).toBe("command-palette-listbox");
  });

  it("sets initial aria-activedescendant to the first selectable option", () => {
    render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        context={sampleContext}
        emails={[sampleEmail]}
        onRunCommand={vi.fn()}
        onNavigate={vi.fn()}
        onSelectEmail={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const combobox = screen.getByRole("combobox");
    const activeId = combobox.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();

    const activeOption = document.getElementById(activeId!);
    expect(activeOption).not.toBeNull();
    expect(activeOption?.getAttribute("role")).toBe("option");
    expect(activeOption?.getAttribute("aria-selected")).toBe("true");
  });

  it("updates aria-activedescendant and aria-selected on ArrowDown and ArrowUp navigation", () => {
    render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        context={sampleContext}
        emails={[sampleEmail]}
        onRunCommand={vi.fn()}
        onNavigate={vi.fn()}
        onSelectEmail={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const combobox = screen.getByRole("combobox");
    const firstId = combobox.getAttribute("aria-activedescendant");

    // Press ArrowDown
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });

    const secondId = combobox.getAttribute("aria-activedescendant");
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);

    const secondOption = document.getElementById(secondId!);
    expect(secondOption?.getAttribute("aria-selected")).toBe("true");

    const firstOption = document.getElementById(firstId!);
    expect(firstOption?.getAttribute("aria-selected")).toBe("false");

    // Press ArrowUp: cycles back to first
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowUp" });
    expect(combobox.getAttribute("aria-activedescendant")).toBe(firstId);
    expect(firstOption?.getAttribute("aria-selected")).toBe("true");
  });

  it("traps keyboard focus within the dialog and keeps focus on Tab", () => {
    render(
      <div>
        <button type="button" data-testid="outside-button">
          Outside
        </button>
        <CommandPalette
          open={true}
          onClose={vi.fn()}
          context={sampleContext}
          emails={[sampleEmail]}
          onRunCommand={vi.fn()}
          onNavigate={vi.fn()}
          onSelectEmail={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    const outside = screen.getByTestId("outside-button");

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(outside);

    // Tab navigation cycles inside the dialog
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open={true}
        onClose={onClose}
        context={sampleContext}
        emails={[sampleEmail]}
        onRunCommand={vi.fn()}
        onNavigate={vi.fn()}
        onSelectEmail={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to previous active element on close", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-testid", "palette-trigger");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        context={sampleContext}
        emails={[sampleEmail]}
        onRunCommand={vi.fn()}
        onNavigate={vi.fn()}
        onSelectEmail={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    rerender(
      <CommandPalette
        open={false}
        onClose={vi.fn()}
        context={sampleContext}
        emails={[sampleEmail]}
        onRunCommand={vi.fn()}
        onNavigate={vi.fn()}
        onSelectEmail={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
