// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChangelog } from "../../../src/features/changelog/useChangelog";
import { STORAGE_KEY } from "../../../src/features/changelog/helpers";

const mocks = vi.hoisted(() => ({
  entries: [
    {
      id: "new-ui",
      version: "0.4.0",
      date: "2026-06-17",
      category: "ui",
      title: "New",
      description: "New entry",
    },
    {
      id: "old-security",
      version: "0.3.0",
      date: "2026-05-28",
      category: "security",
      title: "Old",
      description: "Old entry",
    },
  ],
}));

vi.mock("../../../src/features/changelog/data", () => ({
  CHANGELOG_ENTRIES: mocks.entries,
  LATEST_VERSION: "0.4.0",
}));

describe("useChangelog", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it("returns entries newest-first", () => {
    const { result } = renderHook(() => useChangelog());

    expect(result.current.entries.map((entry) => entry.version))
      .toEqual(["0.4.0", "0.3.0"]);
  });

  it("exposes entries that can be filtered by category", () => {
    const { result } = renderHook(() => useChangelog());

    const security = result.current.entries.filter(
      (entry) => entry.category === "security",
    );

    expect(security.map((entry) => entry.id))
      .toEqual(["old-security"]);
  });

  it("handles an empty result after filtering", () => {
    const { result } = renderHook(() => useChangelog());

    const protocol = result.current.entries.filter(
      (entry) => entry.category === "protocol",
    );

    expect(protocol).toEqual([]);
  });

  it("returns no entries when changelog data is empty", () => {
    const original = [...mocks.entries];

    try {
      mocks.entries.splice(0, mocks.entries.length);

      const { result } = renderHook(() => useChangelog());

      expect(result.current.entries).toEqual([]);
    } finally {
      mocks.entries.splice(0, mocks.entries.length, ...original);
    }
  });
  it("marks all entries seen and persists latest version", () => {
    const { result } = renderHook(() => useChangelog());

    expect(result.current.hasUnread).toBe(true);

    act(() => {
      result.current.markAllSeen();
    });

    expect(result.current.hasUnread).toBe(false);
    expect(localStorage.setItem)
      .toHaveBeenCalledWith(STORAGE_KEY, "0.4.0");
  });
});