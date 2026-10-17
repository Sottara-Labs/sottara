/**
 * @vitest-environment jsdom
 */
import { render, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RequestCard } from "@/features/requests/RequestCard";
import type { Email } from "@/components/mail/data";

const mockEmail: Email = {
  id: "request-1",
  from: "Unknown Sender",
  email: "sender@example.com",
  subject: "Request intro",
  preview: "Intro message",
  body: "Body content",
  time: "Now",
  unread: true,
  starred: false,
  folder: "requests",
  labels: ["Request"],
  avatarColor: "#64748b",
  postageAmount: "15000000",
  verifiedSender: false,
};

describe("RequestCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the latest onFinalizeAction handler when the handler is swapped mid-countdown", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { rerender } = render(
      <RequestCard
        email={mockEmail}
        status="success-approve_once"
        simulateFailure={false}
        onTriggerAction={vi.fn()}
        onUndoAction={vi.fn()}
        onFinalizeAction={handler1}
        onInspect={vi.fn()}
      />,
    );

    // Advance halfway through duration (duration is 3000ms)
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();

    // Parent swaps the handler mid-countdown
    rerender(
      <RequestCard
        email={mockEmail}
        status="success-approve_once"
        simulateFailure={false}
        onTriggerAction={vi.fn()}
        onUndoAction={vi.fn()}
        onFinalizeAction={handler2}
        onInspect={vi.fn()}
      />,
    );

    // Advance past remaining duration
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith("request-1", "approve_once");
  });
});
