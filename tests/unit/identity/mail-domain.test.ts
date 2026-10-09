import { describe, expect, it } from "vitest";

import {
  formatFederationAddress,
  formatMailAddress,
  LOCAL_MAIL_DOMAINS,
  MAIL_DOMAIN,
} from "@/features/identity/mail-domain";

describe("mail-domain", () => {
  it("pins the legacy MAIL_DOMAIN constant", () => {
    // Tracked in the brand-migration guide; any change must be deliberate.
    expect(MAIL_DOMAIN).toBe("betasmail.com");
  });

  it("asserts LOCAL_MAIL_DOMAINS includes MAIL_DOMAIN", () => {
    expect(LOCAL_MAIL_DOMAINS).toContain(MAIL_DOMAIN);
    expect(LOCAL_MAIL_DOMAINS).toContain("betasmail.com");
  });

  it('asserts formatMailAddress("alice") returns alice@<MAIL_DOMAIN>', () => {
    expect(formatMailAddress("alice")).toBe("alice@betasmail.com");
    expect(formatMailAddress("alice")).toBe(`alice@${MAIL_DOMAIN}`);
  });

  it('asserts formatFederationAddress("alice") returns the documented user*domain shape', () => {
    expect(formatFederationAddress("alice")).toBe("alice*betasmail.com");
    expect(formatFederationAddress("alice")).toBe(`alice*${MAIL_DOMAIN}`);
  });
});
