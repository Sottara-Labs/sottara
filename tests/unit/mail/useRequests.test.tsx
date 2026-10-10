// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UnknownSenderRequest } from "@/lib/api";
import { queryKeys, sharedTypedApi as api } from "@/lib/api";
import { useRequests, useSenderRequestDecision } from "@/features/mail/useRequests";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sharedTypedApi: {
      ...actual.sharedTypedApi,
      requests: {
        list: vi.fn(),
        decide: vi.fn(),
      },
    },
  };
});

const actor = "GOWNER";
const request: UnknownSenderRequest = {
  requestId: "request-1",
  recipient: actor,
  sender: "GSENDER",
  message: { messageId: "message-1", ciphertextHash: "hash" },
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-02T00:00:00.000Z",
  status: "pending",
};
const response = { items: [request], nextCursor: "next", hasMore: true };

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("sender request hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches requests with the actor, cursor, and limit in the query key", async () => {
    vi.mocked(api.requests.list).mockResolvedValueOnce(response);
    const options = { cursor: "cursor-1", limit: 25 };
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useRequests(actor, options), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.requests.list).toHaveBeenCalledWith(options, expect.any(AbortSignal));
    expect(result.current.data).toEqual(response);
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
  });

  it.each(["approve_once", "reject"] as const)(
    "posts the %s decision and invalidates dependent lists",
    async (decision) => {
      vi.mocked(api.requests.decide).mockResolvedValueOnce({
        ...request,
        status: decision === "approve_once" ? "approved" : "rejected",
        decision,
      });
      const { queryClient, wrapper } = createWrapper();
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
      const { result } = renderHook(() => useSenderRequestDecision(actor), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ requestId: request.requestId, decision });
      });

      expect(api.requests.decide).toHaveBeenCalledWith(request.requestId, decision);
      for (const key of [
        queryKeys.requests.list(actor),
        queryKeys.mailbox.queue(actor),
        queryKeys.mailbox.sync(actor),
        queryKeys.mailbox.counts(actor),
      ]) {
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: key });
      }
    },
  );

  it("surfaces a rejected decision without invalidating the request list", async () => {
    const error = new Error("decision failed");
    vi.mocked(api.requests.decide).mockRejectedValueOnce(error);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(queryKeys.requests.list(actor), response);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSenderRequestDecision(actor), { wrapper });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ requestId: request.requestId, decision: "block" });
      }),
    ).rejects.toThrow(error);

    expect(queryClient.getQueryData(queryKeys.requests.list(actor))).toEqual(response);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
