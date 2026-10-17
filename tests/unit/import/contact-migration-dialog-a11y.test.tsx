/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ContactMigrationDialog } from "@/features/contacts/import/ContactMigrationDialog";

describe("ContactMigrationDialog accessibility (Issue #412)", () => {
  it("renders with role='dialog', aria-modal='true', and accessible name from heading", () => {
    render(
      <ContactMigrationDialog
        open={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        owner="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Contact migration" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("contact-migration-title");

    const heading = screen.getByRole("heading", { name: "Contact migration" });
    expect(heading.id).toBe("contact-migration-title");
  });

  it("provides an accessible name for the dismiss button and closes on click", () => {
    const onClose = vi.fn();
    render(
      <ContactMigrationDialog
        open={true}
        onClose={onClose}
        onComplete={vi.fn()}
        owner="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      />,
    );

    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toBeTruthy();

    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
