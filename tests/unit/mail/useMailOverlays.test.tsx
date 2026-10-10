/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { defaultPreferences } from "@/features/preferences";
import { useMailOverlays } from "@/features/mail/useMailOverlays";

describe("useMailOverlays", () => {
  it("opens compose with the supplied initial draft", () => {
    const { result } = renderHook(() => useMailOverlays());

    act(() => {
      result.current.openCompose({
        to: "recipient@example.com",
        subject: "Follow-up",
        body: "Draft body",
        draftId: "draft-1",
        version: 3,
      });
    });

    expect(result.current.composeOpen).toBe(true);
    expect(result.current.composeInitial).toEqual({
      to: "recipient@example.com",
      subject: "Follow-up",
      body: "Draft body",
      draftId: "draft-1",
      version: 3,
    });
  });

  it("resets compose state when it is closed and reopened without a draft", () => {
    const { result } = renderHook(() => useMailOverlays());

    act(() => {
      result.current.openCompose({ subject: "Stale subject" });
      result.current.setComposeOpen(false);
      result.current.openCompose();
    });

    expect(result.current.composeOpen).toBe(true);
    expect(result.current.composeInitial).toEqual({});
  });

  it("preserves and clears the settings snapshot through the settings lifecycle", () => {
    const { result } = renderHook(() => useMailOverlays());

    act(() => {
      result.current.openSettings(defaultPreferences);
    });

    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsSnapshot).toBe(defaultPreferences);

    act(() => {
      result.current.closeSettings();
    });

    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.settingsSnapshot).toBeNull();
  });

  it("tracks calendar event and create requests independently", () => {
    const { result } = renderHook(() => useMailOverlays());

    act(() => {
      result.current.openCalendar("event-1");
    });
    expect(result.current.calendarOpen).toBe(true);
    expect(result.current.calendarEventId).toBe("event-1");

    act(() => {
      result.current.requestCalendarCreate();
    });

    expect(result.current.calendarEventId).toBeNull();
    expect(result.current.calendarCreateRequest).toBe(1);
  });

  it("stores the proof inspector query when opening it", () => {
    const { result } = renderHook(() => useMailOverlays());

    act(() => {
      result.current.openProofInspector("sender:alice");
    });

    expect(result.current.proofInspectorOpen).toBe(true);
    expect(result.current.proofInspectorQuery).toBe("sender:alice");
  });
});
