/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  SenderJourney,
  AddressStep,
  QuoteStep,
  PaymentStep,
  DeliveryStep,
} from "@/features/sender-journey/SenderJourney";
import { DEFAULT_JOURNEY_STATE } from "@/features/sender-journey/types";

describe("SenderJourney input label associations (Issue #415)", () => {
  it("associates Recipient address input with its visible label in AddressStep", () => {
    const update = vi.fn();
    render(<AddressStep state={DEFAULT_JOURNEY_STATE} update={update} next={vi.fn()} />);

    const label = screen.getByText(/recipient address/i);
    expect(label.getAttribute("for")).toBe("sender-journey-recipient");

    const input = screen.getByLabelText(/recipient address/i);
    expect(input).toBeTruthy();
    expect(input.getAttribute("id")).toBe("sender-journey-recipient");

    fireEvent.change(input, { target: { value: "alice*stealth.xyz" } });
    expect(update).toHaveBeenCalledWith({ recipientAddress: "alice*stealth.xyz" });
  });

  it("associates Postage input with its label in QuoteStep", () => {
    const update = vi.fn();
    render(
      <QuoteStep state={DEFAULT_JOURNEY_STATE} update={update} next={vi.fn()} back={vi.fn()} />,
    );

    const label = screen.getByText("Postage");
    expect(label.getAttribute("for")).toBe("sender-journey-postage");

    const input = screen.getByLabelText("Postage");
    expect(input).toBeTruthy();
    expect(input.getAttribute("id")).toBe("sender-journey-postage");

    fireEvent.change(input, { target: { value: "5" } });
    expect(update).toHaveBeenCalledWith({ postageAmount: "5" });
  });

  it("associates Subject, Message, and simulation controls in PaymentStep", () => {
    const update = vi.fn();
    render(
      <PaymentStep state={DEFAULT_JOURNEY_STATE} update={update} next={vi.fn()} back={vi.fn()} />,
    );

    const subjectLabel = screen.getByText("Subject");
    expect(subjectLabel.getAttribute("for")).toBe("sender-journey-subject");
    const subjectInput = screen.getByLabelText("Subject");
    expect(subjectInput.getAttribute("id")).toBe("sender-journey-subject");

    const messageLabel = screen.getByText("Message");
    expect(messageLabel.getAttribute("for")).toBe("sender-journey-message");
    const messageInput = screen.getByLabelText("Message");
    expect(messageInput.getAttribute("id")).toBe("sender-journey-message");

    const failureLabel = screen.getByText(/simulate payment failure/i);
    expect(failureLabel.getAttribute("for")).toBe("sender-journey-simulate-payment-failure");
    const failureCheckbox = screen.getByLabelText(/simulate payment failure/i);
    expect(failureCheckbox.getAttribute("id")).toBe("sender-journey-simulate-payment-failure");
  });

  it("associates simulation control in DeliveryStep", () => {
    const update = vi.fn();
    render(<DeliveryStep state={DEFAULT_JOURNEY_STATE} update={update} next={vi.fn()} />);

    const failureLabel = screen.getByText(/simulate delivery failure/i);
    expect(failureLabel.getAttribute("for")).toBe("sender-journey-simulate-delivery-failure");
    const failureCheckbox = screen.getByLabelText(/simulate delivery failure/i);
    expect(failureCheckbox.getAttribute("id")).toBe("sender-journey-simulate-delivery-failure");
  });

  it("renders SenderJourney with initial accessible recipient input", () => {
    render(<SenderJourney />);
    const recipientInput = screen.getByLabelText(/recipient address/i);
    expect(recipientInput).toBeTruthy();
    expect(recipientInput.getAttribute("id")).toBe("sender-journey-recipient");
  });
});
