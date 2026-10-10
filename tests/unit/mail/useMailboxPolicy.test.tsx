// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailboxPolicy, MailboxPolicyWrite } from "@/lib/api";
import { queryKeys, sharedTypedApi as api } from "@/lib/api";
import { useMailboxPolicy, useUpdateMailboxPolicy } from "@/features/mail/usePolicy";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sharedTypedApi: {
      ...actual.sharedTypedApi,
      policies: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

const owner = "GOWNER";
const policy: MailboxPolicy = {
  allowUnknown: true,
  requireVerified: false,
  minimumPostage: "100",
};
const policyWrite: MailboxPolicyWrite = {
  ...policy,
  requireReceipt: true,
  version: 3,
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

describe("mailbox policy hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("only fetches when an owner is supplied and enabled", () => {
    const { wrapper } = createWrapper();
    const { result: noOwner } = renderHook(() => useMailboxPolicy(null), { wrapper });
    const { result: disabled } = renderHook(() => useMailboxPolicy(owner, false), { wrapper });

    expect(noOwner.current.fetchStatus).toBe("idle");
    expect(disabled.current.fetchStatus).toBe("idle");
    expect(api.policies.get).not.toHaveBeenCalled();
  });

  it("reads the mailbox policy through the typed client", async () => {
    vi.mocked(api.policies.get).mockResolvedValueOnce(policy);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMailboxPolicy(owner), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.policies.get).toHaveBeenCalledWith(owner, expect.any(AbortSignal));
    expect(result.current.data).toEqual(policy);
  });

  it("updates the policy and invalidates policy, reconciliation, evaluation, and settings", async () => {
    vi.mocked(api.policies.update).mockResolvedValueOnce(policy);
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateMailboxPolicy(owner), { wrapper });

    act(() => result.current.mutate(policyWrite));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.policies.update).toHaveBeenCalledWith(owner, policyWrite);
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    for (const key of [
      queryKeys.policies.policy(owner),
      queryKeys.policies.reconciliation(owner),
      queryKeys.policies.evaluate(owner),
      queryKeys.settings.all,
    ]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: key });
    }
  });

  it("releases the in-flight guard after a failed update", async () => {
    vi.mocked(api.policies.update)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(policy);
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMailboxPolicy(owner), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(policyWrite)).rejects.toThrow("temporary failure");
    });
    await act(async () => {
      await expect(result.current.mutateAsync(policyWrite)).resolves.toEqual(policy);
    });

    expect(api.policies.update).toHaveBeenCalledTimes(2);
  });
});
