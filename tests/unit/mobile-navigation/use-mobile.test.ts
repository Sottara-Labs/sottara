// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MOBILE_BREAKPOINT, isMobileViewport, useIsMobile } from "../../../src/hooks/use-mobile";
import { useMediaQuery, useIsMobile as useIsMobileFromLib } from "../../../src/lib/use-media-query";

describe("mobile-navigation/isMobileViewport", () => {
  it("treats typical phone and tablet widths as mobile (success path)", () => {
    expect(isMobileViewport(320)).toBe(true); // small phone
    expect(isMobileViewport(390)).toBe(true); // modern phone
    expect(isMobileViewport(767)).toBe(true); // largest mobile width
  });

  it("treats tablet-landscape and desktop widths as not mobile", () => {
    expect(isMobileViewport(768)).toBe(false); // md breakpoint -> desktop
    expect(isMobileViewport(1024)).toBe(false);
    expect(isMobileViewport(1440)).toBe(false);
  });

  it("switches exactly at the Tailwind md breakpoint (edge case)", () => {
    // The boundary must align with Tailwind's `md` (min-width: 768px) so the JS
    // layout switch matches the `md:` utilities on the nav surface.
    expect(MOBILE_BREAKPOINT).toBe(768);
    expect(isMobileViewport(MOBILE_BREAKPOINT - 1)).toBe(true);
    expect(isMobileViewport(MOBILE_BREAKPOINT)).toBe(false);
  });

  it("handles degenerate widths without flipping the contract (failure path)", () => {
    expect(isMobileViewport(0)).toBe(true);
    expect(isMobileViewport(-100)).toBe(true);
  });

  it("shares a single useIsMobile implementation across hooks/use-mobile and lib/use-media-query", () => {
    expect(useIsMobileFromLib).toBe(useIsMobile);
  });

  it("attaches matchMedia listener once per query change rather than re-subscribing on match changes", () => {
    let changeHandler: ((event: MediaQueryListEvent) => void) | null = null;
    const addEventListener = vi.fn((_event: string, cb: (event: MediaQueryListEvent) => void) => {
      changeHandler = cb;
    });
    const removeEventListener = vi.fn();

    const originalMatchMedia = window.matchMedia;
    let currentMatches = false;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return currentMatches;
      },
      media: query,
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
        initialProps: { q: "(max-width: 767px)" },
      });

      expect(result.current).toBe(false);
      expect(addEventListener).toHaveBeenCalledTimes(1);

      act(() => {
        currentMatches = true;
        changeHandler?.({ matches: true } as MediaQueryListEvent);
      });

      expect(result.current).toBe(true);
      expect(addEventListener).toHaveBeenCalledTimes(1);
      expect(removeEventListener).toHaveBeenCalledTimes(0);

      rerender({ q: "(max-width: 1024px)" });
      expect(addEventListener).toHaveBeenCalledTimes(2);
      expect(removeEventListener).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
