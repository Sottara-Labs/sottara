// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SenderAvatar, buildLocalIdenticonDataUri } from "@/components/mail/SenderAvatar";
import type { Email } from "@/components/mail/data";

const sampleEmail: Email = {
  id: "email-1",
  from: "Alice Sovereign",
  email: "alice@stealth.demo",
  subject: "Zero-leak avatar check",
  preview: "Testing local identicon generation",
  body: "Body content",
  time: "10:00 AM",
  unread: true,
  starred: false,
  folder: "inbox",
  avatarColor: "#10b981",
};

describe("SenderAvatar privacy and local identicon generation", () => {
  it("generates a deterministic data:image/svg+xml URI with no third-party host", () => {
    const uri1 = buildLocalIdenticonDataUri(sampleEmail.email, sampleEmail.avatarColor);
    const uri2 = buildLocalIdenticonDataUri(sampleEmail.email, sampleEmail.avatarColor);
    const uriOther = buildLocalIdenticonDataUri("bob@stealth.demo", "#38bdf8");

    expect(uri1).toBe(uri2);
    expect(uri1).not.toBe(uriOther);
    expect(uri1.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(uri1).not.toContain("dicebear");
    expect(uri1).not.toContain("http");
  });

  it("renders SenderAvatar using local data URI and never references api.dicebear.com", () => {
    const { container } = render(<SenderAvatar email={sampleEmail} unread />);
    const img = container.querySelector("img");

    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
    expect(img?.getAttribute("src")).not.toContain("api.dicebear.com");
  });
});
