/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePolicyEditor } from "./usePolicyEditor";
import { sharedTypedApi } from "@/lib/api";
import { ApiClientError } from "@/lib/api/errors";
import type { PolicyReconciliation } from "@/lib/api/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sharedTypedApi: {
      ...actual.sharedTypedApi,
      policies: {
        getReconciliation: vi.fn(),
        update: vi.fn(),
        getRule: vi.fn(),
        setRule: vi.fn(),
      },
    },
  };
});

describe("usePolicyEditor (#424)", () => {
  const testAddress = "GOWNER1234567890";
  let queryClient: QueryClient;

  const baseReconciliation: PolicyReconciliation = {
    address: testAddress,
    state: "synced",
    offchain: {
      policy: {
        allowUnknown: true,
        requireVerified: false,
        minimumPostage: "0.05",
      },
      version: 3,
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
    onchain: {
      policy: {
        allowUnknown: true,
        requireVerified: false,
        minimumPostage: "0.05",
      },
      syncedAt: "2026-10-17T00:00:00.000Z",
    },
    writeIntent: null,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("loads remote policy reconciliation and initializes clean draft state", async () => {
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValueOnce(baseReconciliation);

    const { result } = renderHook(() => usePolicyEditor(testAddress), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.livePolicy).toEqual(baseReconciliation.offchain.policy);
    expect(result.current.draftPolicy).toEqual(baseReconciliation.offchain.policy);
    expect(result.current.version).toBe(3);
    expect(result.current.reconciliationState).toBe("synced");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.dirtyFields).toEqual([]);
    expect(result.current.validationErrors).toEqual({});
  });

  it("tracks dirty fields on edit, validates invalid combinations, and reverts via resetDraft()", async () => {
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValueOnce(baseReconciliation);

    const { result } = renderHook(() => usePolicyEditor(testAddress), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateDraft({
        allowUnknown: false,
        requireVerified: true,
        minimumPostage: "2.5",
      });
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.dirtyFields).toEqual([
      "allowUnknown",
      "requireVerified",
      "minimumPostage",
    ]);
    expect(result.current.validationErrors).toEqual({
      minimumPostage: "Postage cannot exceed 1 XLM.",
      requireVerified: "Verification cannot be required when unknown senders are disabled.",
    });

    await act(async () => {
      await expect(result.current.saveDraft()).rejects.toThrow("Validation failed");
    });
    expect(sharedTypedApi.policies.update).not.toHaveBeenCalled();

    act(() => {
      result.current.resetDraft();
    });

    expect(result.current.isDirty).toBe(false);
    expect(result.current.dirtyFields).toEqual([]);
    expect(result.current.validationErrors).toEqual({});
    expect(result.current.draftPolicy).toEqual(baseReconciliation.offchain.policy);
  });

  it("saves valid draft changes with optimistic concurrency version and invalidates queries", async () => {
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValue(baseReconciliation);
    vi.mocked(sharedTypedApi.policies.update).mockResolvedValueOnce({} as any);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePolicyEditor(testAddress), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateDraft({ minimumPostage: "0.25", requireVerified: true });
    });

    expect(result.current.validationErrors).toEqual({});

    await act(async () => {
      await result.current.saveDraft();
    });

    expect(sharedTypedApi.policies.update).toHaveBeenCalledWith(testAddress, {
      allowUnknown: true,
      requireVerified: true,
      minimumPostage: "0.25",
      version: 3,
    });
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("surfaces 409 conflicts via hasConflict without setting generic saveError", async () => {
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValueOnce(baseReconciliation);
    const conflictErr = new ApiClientError({
      status: 409,
      code: "CONFLICT",
      message: "Version mismatch",
    });
    vi.mocked(sharedTypedApi.policies.update).mockRejectedValueOnce(conflictErr);

    const { result } = renderHook(() => usePolicyEditor(testAddress), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateDraft({ minimumPostage: "0.1" });
    });

    await act(async () => {
      await expect(result.current.saveDraft()).rejects.toThrow("Version mismatch");
    });

    await waitFor(() => {
      expect(result.current.hasConflict).toBe(true);
    });
    expect(result.current.saveError).toBeNull();
  });

  it("surfaces non-conflict save failures via saveError and elevates failed writeIntent state", async () => {
    const failedIntentRecon: PolicyReconciliation = {
      ...baseReconciliation,
      state: "pending_write",
      writeIntent: {
        status: "failed",
        error: "On-chain tx failed",
      } as any,
    };
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValueOnce(failedIntentRecon);
    vi.mocked(sharedTypedApi.policies.update).mockRejectedValueOnce(
      new Error("Relay unavailable"),
    );

    const { result } = renderHook(() => usePolicyEditor(testAddress), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.reconciliationState).toBe("failed");

    await act(async () => {
      await expect(result.current.saveDraft()).rejects.toThrow("Relay unavailable");
    });

    await waitFor(() => {
      expect(result.current.saveError).toBe("Relay unavailable");
    });
    expect(result.current.hasConflict).toBe(false);
  });

  it("supports getSenderRule and setSenderRule and handles missing address safely", async () => {
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValueOnce(baseReconciliation);
    vi.mocked(sharedTypedApi.policies.getRule).mockResolvedValueOnce({ rule: "allow" } as any);
    vi.mocked(sharedTypedApi.policies.setRule).mockResolvedValueOnce({} as any);

    const { result } = renderHook(() => usePolicyEditor(testAddress), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const rule = await result.current.getSenderRule("GSENDER123");
    expect(rule).toBe("allow");
    expect(sharedTypedApi.policies.getRule).toHaveBeenCalledWith(testAddress, "GSENDER123");

    await act(async () => {
      await result.current.setSenderRule("GSENDER123", "block");
    });
    expect(sharedTypedApi.policies.setRule).toHaveBeenCalledWith(testAddress, "GSENDER123", "block");

    const { result: noAddr } = renderHook(() => usePolicyEditor(undefined), { wrapper });
    expect(await noAddr.current.getSenderRule("GSENDER123")).toBe("default");
  });
});
