/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { format } from "date-fns";

import { useSnooze, type SnoozeTarget } from "../../../src/features/snooze/useSnooze";
import { SnoozeDialog } from "../../../src/features/snooze/SnoozeDialog";
import {
  SNOOZE_PRESETS,
  buildSnoozeState,
  validateCustomSnooze,
  snoozePatch,
  unsnoozePatch,
} from "../../../src/features/snooze/types";
import { getReferenceNow } from "../../../src/features/calendar/dateUtils";

describe("useSnooze hook and snooze dialog integration", () => {
  const now = getReferenceNow(); // 2026-06-13 09:41 (Saturday)
  const sampleTarget: SnoozeTarget = {
    emailId: "email-123",
    subject: "Q3 Strategy Review",
  };

  describe("useSnooze hook state transitions", () => {
    it("initializes with closed dialog and null target", () => {
      const { result } = renderHook(() => useSnooze());
      expect(result.current.isOpen).toBe(false);
      expect(result.current.target).toBeNull();
    });

    it("opens dialog with target when open() is invoked", () => {
      const { result } = renderHook(() => useSnooze());
      act(() => {
        result.current.open(sampleTarget);
      });
      expect(result.current.isOpen).toBe(true);
      expect(result.current.target).toEqual(sampleTarget);
    });

    it("closes dialog and resets target when close() is invoked", () => {
      const { result } = renderHook(() => useSnooze());
      act(() => {
        result.current.open(sampleTarget);
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.close();
      });
      expect(result.current.isOpen).toBe(false);
      expect(result.current.target).toBeNull();
    });

    it("replaces existing target when open() is called with a new target", () => {
      const { result } = renderHook(() => useSnooze());
      act(() => {
        result.current.open(sampleTarget);
      });
      const nextTarget: SnoozeTarget = {
        emailId: "email-456",
        subject: "Budget Allocations",
      };
      act(() => {
        result.current.open(nextTarget);
      });
      expect(result.current.target).toEqual(nextTarget);
    });
  });

  describe("preset resolution with frozen clock", () => {
    it("resolves each preset against frozen now matching SNOOZE_PRESETS", () => {
      for (const preset of SNOOZE_PRESETS) {
        const resolved = preset.resolve(now);
        expect(resolved).toBeInstanceOf(Date);
        expect(resolved.getTime()).toBeGreaterThan(now.getTime());
      }
    });

    it("resolves tomorrow and next-week presets to expected canonical dates", () => {
      const tomorrow = SNOOZE_PRESETS.find((p) => p.id === "tomorrow")!.resolve(now);
      expect(format(tomorrow, "yyyy-MM-dd HH:mm")).toBe("2026-06-14 09:00");

      const nextWeek = SNOOZE_PRESETS.find((p) => p.id === "next-week")!.resolve(now);
      expect(format(nextWeek, "yyyy-MM-dd HH:mm")).toBe("2026-06-15 09:00");

      const laterToday = SNOOZE_PRESETS.find((p) => p.id === "later-today")!.resolve(now);
      expect(format(laterToday, "yyyy-MM-dd")).toBe("2026-06-13");
    });
  });

  describe("SnoozeDialog wire-up and confirmation", () => {
    it("renders nothing when target is null", () => {
      const { container } = render(
        <SnoozeDialog target={null} events={[]} onConfirm={vi.fn()} onClose={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("confirms preset snooze and calls onConfirm with buildSnoozeState output", () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <SnoozeDialog target={sampleTarget} events={[]} onConfirm={onConfirm} onClose={onClose} />,
      );

      // Select 'Tomorrow' preset button
      const tomorrowButton = screen.getByRole("button", { name: /Tomorrow/i });
      fireEvent.click(tomorrowButton);

      // Click Confirm button
      const confirmButton = screen.getByRole("button", { name: /^Snooze$/i });
      fireEvent.click(confirmButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const [receivedTarget, receivedState] = onConfirm.mock.calls[0];
      expect(receivedTarget).toEqual(sampleTarget);

      const expectedWake = SNOOZE_PRESETS.find((p) => p.id === "tomorrow")!.resolve(now);
      const expectedState = buildSnoozeState("tomorrow", expectedWake, now);
      expect(receivedState).toEqual(expectedState);
    });

    it("rejects invalid custom snooze input and surfaces error without calling onConfirm", () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <SnoozeDialog target={sampleTarget} events={[]} onConfirm={onConfirm} onClose={onClose} />,
      );

      // Click 'Pick a date & time' button to reveal inputs
      const customButton = screen.getByRole("button", { name: /Pick a date & time/i });
      fireEvent.click(customButton);

      // Enter past date
      const dateInput = screen.getByLabelText(/Date/i);
      const timeInput = screen.getByLabelText(/Time/i);

      fireEvent.change(dateInput, { target: { value: "2026-06-12" } }); // Yesterday
      fireEvent.change(timeInput, { target: { value: "08:00" } });

      // Verify validation failure message is rendered
      expect(screen.getByText(/Choose a moment in the future/i)).toBeTruthy();

      // Snooze button should be disabled
      const confirmButton = screen.getByRole("button", { name: /^Snooze$/i }) as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(true);

      fireEvent.click(confirmButton);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("allows valid custom date/time and confirms with built snooze state", () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      render(
        <SnoozeDialog target={sampleTarget} events={[]} onConfirm={onConfirm} onClose={onClose} />,
      );

      // Open custom
      const customButton = screen.getByRole("button", { name: /Pick a date & time/i });
      fireEvent.click(customButton);

      const dateInput = screen.getByLabelText(/Date/i);
      const timeInput = screen.getByLabelText(/Time/i);

      fireEvent.change(dateInput, { target: { value: "2026-06-20" } });
      fireEvent.change(timeInput, { target: { value: "15:00" } });

      const confirmButton = screen.getByRole("button", { name: /^Snooze$/i }) as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(false);
      fireEvent.click(confirmButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const [receivedTarget, receivedState] = onConfirm.mock.calls[0];
      expect(receivedTarget).toEqual(sampleTarget);
      expect(receivedState.choice).toBe("custom");
      expect(format(new Date(receivedState.remindAt), "yyyy-MM-dd HH:mm")).toBe("2026-06-20 15:00");
    });

    it("does not reset the chosen snooze time when parent re-renders with a new target object identity", () => {
      const onConfirm = vi.fn();
      const onClose = vi.fn();

      const { rerender } = render(
        <SnoozeDialog target={sampleTarget} events={[]} onConfirm={onConfirm} onClose={onClose} />,
      );

      // Select "Tomorrow"
      const tomorrowBtn = screen.getByRole("button", { name: /Tomorrow/i });
      fireEvent.click(tomorrowBtn);
      expect(tomorrowBtn.getAttribute("aria-pressed")).toBe("true");

      // Parent re-renders with fresh target object identity
      rerender(
        <SnoozeDialog
          target={{ ...sampleTarget }}
          events={[]}
          onConfirm={onConfirm}
          onClose={onClose}
        />,
      );

      // Chosen snooze preset should still be selected
      const tomorrowBtnAfterRerender = screen.getByRole("button", { name: /Tomorrow/i });
      expect(tomorrowBtnAfterRerender.getAttribute("aria-pressed")).toBe("true");

      const confirmButton = screen.getByRole("button", { name: /^Snooze$/i }) as HTMLButtonElement;
      expect(confirmButton.disabled).toBe(false);
    });
  });

  describe("patch reuse contract", () => {
    it("maps confirmed preset state directly to snoozePatch without modification", () => {
      const wake = SNOOZE_PRESETS.find((p) => p.id === "tomorrow")!.resolve(now);
      const state = buildSnoozeState("tomorrow", wake, now);

      const patch = snoozePatch(state);
      expect(patch.folder).toBe("snoozed");
      expect(patch.time).toBe("Tomorrow");
      expect(patch.snooze).toBe(state);
    });

    it("maps unsnooze directly to unsnoozePatch output", () => {
      const patch = unsnoozePatch();
      expect(patch.folder).toBe("inbox");
      expect(patch.snooze).toBeUndefined();
    });
  });
});
