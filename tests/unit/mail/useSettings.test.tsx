// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailboxPolicy, MailboxSettings, MailboxPolicyWrite } from "@/lib/api";
import { queryKeys, sharedTypedApi as api } from "@/lib/api";
import { useMailboxSettings, useUpdateMailboxSettings } from "@/features/mail/useSettings";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sharedTypedApi: {
      ...actual.sharedTypedApi,
      settings: {
        read: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

const owner = "GOWNER";
const initialPolicy: MailboxPolicy = {
  allowUnknown: false,
  requireVerified: true,
  minimumPostage: "25",
};
const updatedPolicy: MailboxPolicy = {
  allowUnknown: true,
  requireVerified: false,
  minimumPostage: "100",
};
const initialSettings: MailboxSettings = {
  policy: initialPolicy,
  requireReceipt: false,
};
const updatedSettings: MailboxSettings = {
  policy: updatedPolicy,
  requireReceipt: false,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("mailbox settings hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stays idle without an owner and fetches settings for an enabled owner", async () => {
    vi.mocked(api.settings.read).mockResolvedValueOnce(initialSettings);
    const { wrapper } = createWrapper();
    const { result: noOwner } = renderHook(() => useMailboxSettings(null), { wrapper });
    const { result: enabled } = renderHook(() => useMailboxSettings(owner), { wrapper });

    expect(noOwner.current.fetchStatus).toBe("idle");
    await waitFor(() => expect(enabled.current.isSuccess).toBe(true));

    expect(api.settings.read).toHaveBeenCalledWith(owner, expect.any(AbortSignal));
    expect(enabled.current.data).toEqual(initialSettings);
  });

  it("sends only the changed settings fields supplied by the caller", async () => {
    const changedFields: MailboxPolicyWrite = { minimumPostage: "100" } as MailboxPolicyWrite;
    vi.mocked(api.settings.update).mockResolvedValueOnce(updatedPolicy);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMailboxSettings(owner), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(changedFields);
    });

    expect(api.settings.update).toHaveBeenCalledWith(owner, changedFields);
  });

  it("refreshes the active settings query after a successful update", async () => {
    vi.mocked(api.settings.read)
      .mockResolvedValueOnce(initialSettings)
      .mockResolvedValueOnce(updatedSettings);
    vi.mocked(api.settings.update).mockResolvedValueOnce(updatedPolicy);
    const { queryClient, wrapper } = createWrapper();
    const { result: settings } = renderHook(() => useMailboxSettings(owner), { wrapper });
    const { result: update } = renderHook(() => useUpdateMailboxSettings(owner), { wrapper });

    await waitFor(() => expect(settings.current.data).toEqual(initialSettings));
    await act(async () => {
      await update.current.mutateAsync(updatedPolicy);
    });

    await waitFor(() => expect(settings.current.data).toEqual(updatedSettings));
    expect(queryClient.getQueryData(queryKeys.settings.all)).toEqual(updatedSettings);
  });
});
