// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoMailReader } from "@/features/demo-admin-dashboard/components/DemoMailReader";
import type { DemoMessage } from "@/features/demo-admin-dashboard/types/dataset";

const baseMessage: DemoMessage = {
  id: "msg-demo-1",
  threadId: "thread-demo-1",
  subject: "Security Review Update",
  snippet: "Safe preview text",
  body: "<p>Hello world</p><script>window.__xssExecuted = true;</script><img src=x onerror=\"alert(1)\" /><p>Follow-up text</p>",
  sender: {
    address: "alice@example.com",
    name: "Alice Example",
    isTrusted: true,
  },
  recipients: ["bob@example.com"],
  date: "2026-07-01T10:00:00",
  isRead: true,
  isStarred: false,
  labels: ["security"],
  attachments: [],
};

describe("DemoMailReader HTML sanitisation", () => {
  it("neutralises script tags and inline event handlers instead of injecting raw HTML", () => {
    const { container } = render(
      <DemoMailReader message={baseMessage} onBackToList={vi.fn()} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("Follow-up text")).toBeInTheDocument();
  });
});
