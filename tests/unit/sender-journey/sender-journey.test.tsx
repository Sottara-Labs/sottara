/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PaymentStep, DeliveryStep, RefundStep } from "@/features/sender-journey/SenderJourney";
import { DEFAULT_JOURNEY_STATE, type JourneyState } from "@/features/sender-journey/types";

describe("SenderJourney timer lifecycle and unmount safety", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("PaymentStep", () => {
    it("clears simulation and nested timers when unmounted mid-animation", () => {
      const update = vi.fn();
      const next = vi.fn();
      const back = vi.fn();
      const state: JourneyState = {
        ...DEFAULT_JOURNEY_STATE,
        subject: "Test Subject",
        body: "Test Body",
        paymentStatus: "idle",
      };

      const { unmount } = render(
        <PaymentStep state={state} update={update} next={next} back={back} />,
      );

      const sendButton = screen.getByRole("button", { name: /send message/i });
      fireEvent.click(sendButton);

      expect(update).toHaveBeenCalledWith({ paymentStatus: "pending" });
      update.mockClear();

      // Unmount before the 1500ms payment timer fires
      unmount();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // No state update and no step navigation should occur after unmount
      expect(update).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("clears nested navigation timer when unmounted during transition to next stage", () => {
      const update = vi.fn();
      const next = vi.fn();
      const back = vi.fn();
      const state: JourneyState = {
        ...DEFAULT_JOURNEY_STATE,
        subject: "Test Subject",
        body: "Test Body",
        paymentStatus: "idle",
      };

      const { unmount } = render(
        <PaymentStep state={state} update={update} next={next} back={back} />,
      );

      const sendButton = screen.getByRole("button", { name: /send message/i });
      fireEvent.click(sendButton);

      // Advance through the initial 1500ms payment timer, which schedules the 800ms nested timer
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(update).toHaveBeenCalledWith({ paymentStatus: "success" });
      expect(next).not.toHaveBeenCalled();

      // Unmount before the 800ms nested timer fires
      unmount();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // next() must not be called after unmount
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("DeliveryStep", () => {
    it("clears delivery timer on unmount and prevents state update", () => {
      const update = vi.fn();
      const next = vi.fn();
      const state: JourneyState = {
        ...DEFAULT_JOURNEY_STATE,
        deliveryStatus: "idle",
      };

      const { unmount } = render(
        <DeliveryStep state={state} update={update} next={next} />,
      );

      const checkDeliveryButton = screen.getByRole("button", { name: /check delivery/i });
      fireEvent.click(checkDeliveryButton);

      expect(update).toHaveBeenCalledWith({ deliveryStatus: "pending" });
      update.mockClear();

      // Unmount mid-simulation
      unmount();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("RefundStep", () => {
    it("clears refund timer on unmount and prevents state update", () => {
      const update = vi.fn();

      const { unmount } = render(<RefundStep update={update} />);

      const refundButton = screen.getByRole("button", { name: /request refund/i });
      fireEvent.click(refundButton);

      // Unmount mid-processing
      unmount();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Component is unmounted; no unhandled state update or error occurs
      expect(update).not.toHaveBeenCalled();
    });
  });
});
