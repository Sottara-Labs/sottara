/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FeedbackPanel } from "@/features/feedback/FeedbackAdminPanel";

const mockReports = [
  {
    reportId: "rep_12345",
    category: "bug",
    severity: "high",
    status: "open",
    steps: "1. Click compose 2. Type message 3. Observe crash",
    screenshotConsent: false,
    screenshotDataUrl: null,
    diagnostics: { browser: "Chrome", route: "/inbox" },
    reporterId: "user_test_token_999",
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
    triageNotes: null,
    resolvedBy: null,
    resolvedAt: null,
  },
];

describe("FeedbackAdminPanel expander accessibility (Issue #414)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      if (String(url).includes("/api/v1/admin/feedback")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              reports: mockReports,
              total: 1,
            },
          }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders report expander as a button with proper ARIA attributes", async () => {
    render(<FeedbackPanel />);

    await waitFor(() => {
      expect(screen.queryByText(/loading reports/i)).toBeNull();
    });

    const expander = screen.getByRole("button", {
      name: /Click compose/i,
    });
    expect(expander).toBeTruthy();
    expect(expander.getAttribute("type")).toBe("button");
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(expander.getAttribute("aria-controls")).toBe("report-detail-rep_12345");
  });

  it("toggles aria-expanded and detail visibility with click or keyboard activation", async () => {
    render(<FeedbackPanel />);

    await waitFor(() => {
      expect(screen.queryByText(/loading reports/i)).toBeNull();
    });

    const expander = screen.getByRole("button", {
      name: /Click compose/i,
    });

    // Initially collapsed
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Steps (redacted)")).toBeNull();

    // Expand on click / Enter
    fireEvent.click(expander);
    expect(expander.getAttribute("aria-expanded")).toBe("true");

    const detailContainer = document.getElementById("report-detail-rep_12345");
    expect(detailContainer).toBeTruthy();
    expect(screen.getByText("Steps (redacted)")).toBeTruthy();
    expect(screen.getAllByText(/1\. Click compose/i)).toHaveLength(2);

    // Collapse on second click
    fireEvent.click(expander);
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Steps (redacted)")).toBeNull();
  });
});
