/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { IdentityReviewTable } from "@/features/contacts/import/IdentityReviewTable";
import type { ImportedContactRow } from "@/features/contacts/import/types";

const mockRows: ImportedContactRow[] = [
  {
    id: "row_1",
    name: "Alice Smith",
    address: "alice*example.com",
    source: "csv",
    trust: "default",
    match: null,
    error: null,
  },
  {
    id: "row_2",
    name: "Bob Jones",
    address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    source: "csv",
    trust: "allow",
    match: null,
    error: null,
  },
];

describe("IdentityReviewTable accessibility (Issue #413)", () => {
  it("provides accessible names for all search, name, trust, and address form controls", () => {
    render(<IdentityReviewTable rows={mockRows} onChange={vi.fn()} />);

    // 1. Search control
    const searchInput = screen.getByRole("textbox", { name: /search by name or address/i });
    expect(searchInput).toBeTruthy();
    expect(searchInput.getAttribute("id")).toBe("identity-review-search");

    // 2. Name inputs for each row
    const nameInputs = screen.getAllByRole("textbox", { name: "Name" });
    expect(nameInputs).toHaveLength(2);
    expect(nameInputs[0].getAttribute("id")).toBe("contact-name-row_1");
    expect(nameInputs[1].getAttribute("id")).toBe("contact-name-row_2");

    // 3. Trust selects for each row
    const trustSelects = screen.getAllByRole("combobox", { name: "Trust" });
    expect(trustSelects).toHaveLength(2);
    expect(trustSelects[0].getAttribute("id")).toBe("contact-trust-row_1");
    expect(trustSelects[1].getAttribute("id")).toBe("contact-trust-row_2");

    // 4. Address inputs for each row
    const addressInputs = screen.getAllByRole("textbox", { name: "Address" });
    expect(addressInputs).toHaveLength(2);
    expect(addressInputs[0].getAttribute("id")).toBe("contact-address-row_1");
    expect(addressInputs[1].getAttribute("id")).toBe("contact-address-row_2");
  });

  it("asserts no control relies on a placeholder alone for its accessible name", () => {
    const { container } = render(<IdentityReviewTable rows={mockRows} onChange={vi.fn()} />);

    const controls = container.querySelectorAll("input, select");
    expect(controls.length).toBeGreaterThan(0);

    controls.forEach((control) => {
      // Must have either an aria-label or an associated label via id/htmlFor
      const ariaLabel = control.getAttribute("aria-label");
      const id = control.getAttribute("id");
      const associatedLabel = id ? container.querySelector(`label[for="${id}"]`) : null;

      const hasAccessibleName = Boolean(
        (ariaLabel && ariaLabel.trim().length > 0) ||
        (associatedLabel && associatedLabel.textContent?.trim().length),
      );

      expect(hasAccessibleName).toBe(true);
    });
  });

  it("updates row values when inputs are modified", () => {
    const onChange = vi.fn();
    render(<IdentityReviewTable rows={mockRows} onChange={onChange} />);

    const nameInputs = screen.getAllByRole("textbox", { name: "Name" });
    fireEvent.change(nameInputs[0], { target: { value: "Alice Updated" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].name).toBe("Alice Updated");

    const trustSelects = screen.getAllByRole("combobox", { name: "Trust" });
    fireEvent.change(trustSelects[0], { target: { value: "block" } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
