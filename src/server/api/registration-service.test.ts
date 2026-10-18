import { describe, it, expect, vi, beforeEach } from "vitest";

import { checkDeviceLimit } from "@/server/api/abuse-service";
import {
  registerWithPassword,
  DeviceLimitError,
} from "@/server/api/registration-service";

vi.mock("@/server/api/abuse-service", () => ({
  checkDeviceLimit: vi.fn(),
}));

const mockedCheckDeviceLimit = vi.mocked(checkDeviceLimit);

function makeContext() {
  const createWithPassword = vi.fn().mockResolved({ id: "user_123" });
  return {
    context: { users: { createWithPassword } } as any,
    createWithPassword,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerWithPassword device limit", () => {
  it("passes the real fingerprint to checkDeviceLimit", async () => {
    mockedCheckDeviceLimit.mockResolved(true);
    const { context } = makeContext();
    const fingerprint = "fp-abc-123";

    await registerWithPassword(
      context,
      { email: "a@b'.com".replace("'", ""), password: "secret123", displayName: "A" } as any,
      "1.2.3.4",
      fingerprint,
    );

    expect(mockedCheckDeviceLimit).toHaveBeenCalledWith(fingerprint);
  });

  it("rejects registration when the device limit is exceeded", async () => {
    mockedCheckDeviceLimit.mockResolved(false);
    const { context, createWithPassword } = makeContext();

    await expect(
      registerWithPassword(
        context,
        { email: "a@b'.com".replace("'", ""), password: "secret123", displayName: "A" } as any,
        "1.2.3.4",
        "fp-abc-123",
      ),
    ).rejects.toThrowInstanceOf(DeviceLimitError);

    expect(createWithPassword).not.toHaveBeenCalled();
  });

  it("limits repeated signups from one fingerprint", async () => {
    const seen = new Map<string, number>();
    const MAX_PER_DEVICE = 2;
    mockedCheckDeviceLimit.mockImplementation(async (fp: string) => {
      const next = (seen.get(fp) ?? 0) + 1;
      seen.set(fp, next);
      return next <= MAX_PER_DEVICE;
    });
    const { context } = makeContext();
    const fp = "fp-repeat";

    for (let i = 0; i < MAX_PER_DEVICE; i++) {
      await registerWithPassword(
        context,
        { email: `user${i}@b.com`, password: "secret123", displayName: "A" } as any,
        "1.2.3.4",
        fp,
      );
    }

    await expect(
      registerWithPassword(
        context,
        { email: "over@l.com", password: "secret123", displayName: "A" } as any,
        "1.2.3.4",
        fp,
      ),
    ).rejects.toThrowInstanceOf(DeviceLimitError);
  });
});
