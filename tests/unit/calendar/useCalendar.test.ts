// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  to24HourTime,
  addOneHour,
  useCalendar,
} from "../../../src/features/calendar/useCalendar";

describe("useCalendar pure helpers", () => {
  describe("to24HourTime", () => {
    it("parses AM times correctly", () => {
      expect(to24HourTime("9:30 AM")).toBe("09:30");
      expect(to24HourTime("11:00 AM")).toBe("11:00");
    });

    it("parses PM times correctly", () => {
      expect(to24HourTime("2:15 PM")).toBe("14:15");
      expect(to24HourTime("11:59 PM")).toBe("23:59");
    });

    it("handles 12 AM and 12 PM correctly", () => {
      expect(to24HourTime("12:00 AM")).toBe("00:00");
      expect(to24HourTime("12:30 PM")).toBe("12:30");
    });

    it("parses 24-hour times without AM/PM", () => {
      expect(to24HourTime("14:00")).toBe("14:00");
      expect(to24HourTime("08:45")).toBe("08:45");
    });

    it("returns default 09:00 for invalid formats", () => {
      expect(to24HourTime("invalid time")).toBe("09:00");
      expect(to24HourTime("")).toBe("09:00");
    });
  });

  describe("addOneHour", () => {
    it("adds an hour to a standard morning time", () => {
      expect(addOneHour("09:30")).toBe("10:30");
    });

    it("adds an hour and wraps around midnight correctly", () => {
      expect(addOneHour("23:15")).toBe("00:15");
    });

    it("handles single digit hours padded with zero", () => {
      expect(addOneHour("08:05")).toBe("09:05");
    });
  });
});

describe("useCalendar storage resilience (Issue #395)", () => {
  it("keeps calendar functional in memory when localStorage.setItem throws", () => {
    const store = new Map<string, string>();
    const mockStorage = {
      getItem: vi.fn((k: string) => store.get(k) ?? null),
      setItem: vi.fn(() => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }),
      removeItem: vi.fn((k: string) => {
        store.delete(k);
      }),
      clear: vi.fn(() => store.clear()),
      length: 0,
      key: vi.fn(() => null),
    };
    vi.stubGlobal("localStorage", mockStorage);

    const { result, unmount } = renderHook(() => useCalendar());

    const initialCount = result.current.visibleEvents.length;

    // Save a new event in memory despite throwing localStorage
    act(() => {
      result.current.saveEvent({
        title: "Team Sync",
        date: "2026-10-20",
        time: "10:00",
        endTime: "11:00",
        calendarId: "work",
      });
    });

    expect(result.current.visibleEvents.length).toBe(initialCount + 1);
    expect(
      result.current.visibleEvents.some((e) => e.title === "Team Sync"),
    ).toBe(true);

    unmount();
    vi.unstubAllGlobals();
  });

  it("loads default calendar data without crashing when localStorage.getItem throws", () => {
    const mockStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("SecurityError", "SecurityError");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    };
    vi.stubGlobal("localStorage", mockStorage);

    const { result, unmount } = renderHook(() => useCalendar());

    expect(result.current.visibleEvents.length).toBeGreaterThan(0);

    unmount();
    vi.unstubAllGlobals();
  });
});
