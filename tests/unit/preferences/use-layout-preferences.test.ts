// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  clampLayoutPreferences,
  useLayoutPreferences,
} from "../../../src/features/preferences/useLayoutPreferences";
import {
  defaultLayoutPreferences,
  type LayoutPreferences,
} from "../../../src/features/preferences/layout-types";

describe("preferences/clampLayoutPreferences", () => {
  it("leaves in-range layout widths untouched (success path)", () => {
    const inRange: LayoutPreferences = {
      ...defaultLayoutPreferences,
      sidebarWidth: 15,
      listWidth: 30,
      readerWidth: 35,
    };
    expect(clampLayoutPreferences(inRange)).toEqual(inRange);
  });

  it("clamps out-of-range widths back into the usable bounds (edge case)", () => {
    const tooWide: LayoutPreferences = {
      ...defaultLayoutPreferences,
      sidebarWidth: 95,
      listWidth: 95,
      readerWidth: 95,
    };
    expect(clampLayoutPreferences(tooWide)).toMatchObject({
      sidebarWidth: 40,
      listWidth: 60,
      readerWidth: 80,
    });

    const tooNarrow: LayoutPreferences = {
      ...defaultLayoutPreferences,
      sidebarWidth: 0,
      listWidth: 1,
      readerWidth: 2,
    };
    expect(clampLayoutPreferences(tooNarrow)).toMatchObject({
      sidebarWidth: 5,
      listWidth: 10,
      readerWidth: 15,
    });
  });

  it("preserves the exact min and max bounds (boundary values)", () => {
    const atBounds: LayoutPreferences = {
      ...defaultLayoutPreferences,
      sidebarWidth: 40,
      listWidth: 10,
      readerWidth: 80,
    };
    expect(clampLayoutPreferences(atBounds)).toMatchObject({
      sidebarWidth: 40,
      listWidth: 10,
      readerWidth: 80,
    });
  });

  it("does not mutate the input object (failure-safety)", () => {
    const input: LayoutPreferences = {
      ...defaultLayoutPreferences,
      sidebarWidth: 100,
    };
    const snapshot = { ...input };
    clampLayoutPreferences(input);
    expect(input).toEqual(snapshot);
  });

  it("carries non-width fields through unchanged", () => {
    const input: LayoutPreferences = {
      ...defaultLayoutPreferences,
      sidebarCollapsed: true,
      rightPanelCollapsed: true,
      compactMode: true,
      sidebarWidth: 999,
    };
    const result = clampLayoutPreferences(input);
    expect(result.sidebarCollapsed).toBe(true);
    expect(result.rightPanelCollapsed).toBe(true);
    expect(result.compactMode).toBe(true);
  });
});

describe("preferences/useLayoutPreferences storage resilience (Issue #394)", () => {
  it("applies layout preference changes in memory when localStorage.setItem throws (DOMException)", () => {
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

    const { result, unmount } = renderHook(() => useLayoutPreferences());

    expect(result.current.hydrated).toBe(true);
    expect(result.current.layout.sidebarWidth).toBe(defaultLayoutPreferences.sidebarWidth);

    // Update layout preference
    act(() => {
      result.current.setLayout({ sidebarWidth: 25 });
    });

    // In-memory state must update successfully and component must remain mounted
    expect(result.current.layout.sidebarWidth).toBe(25);

    unmount();
    vi.unstubAllGlobals();
  });

  it("loads in-memory defaults without crashing when localStorage.getItem throws", () => {
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

    const { result, unmount } = renderHook(() => useLayoutPreferences());

    expect(result.current.hydrated).toBe(true);
    expect(result.current.layout).toEqual(defaultLayoutPreferences);

    unmount();
    vi.unstubAllGlobals();
  });
});
