// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  useReceiptQueueReplay,
  enqueueReceiptAction,
  readReceiptQueue,
  clearReceiptQueue,
} from "@/features/mail/useReceipts";
import { sharedTypedApi } from "@/lib/api";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, val: string) => {
    storage.set(key, String(val));
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  get length() {
    return storage.size;
  },
  key: (i: number) => Array.from(storage.keys())[i] ?? null,
};
vi.stubGlobal("localStorage", localStorageMock);

describe("useReceiptQueueReplay multi-flush (Issue #397)", () => {
  let queryClient: QueryClient;
  let markReadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storage.clear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    markReadSpy = vi.spyOn(sharedTypedApi.receipts, "markRead").mockImplementation(
      async (messageId: string) => ({
        messageId,
        sender: "sender@example.com",
        recipient: "actor@example.com",
        deliveredAt: new Date().toISOString(),
        readAt: new Date().toISOString(),
        chainStatus: "confirmed",
      }),
    );
  });

  afterEach(() => {
    markReadSpy.mockRestore();
    clearReceiptQueue();
  });

  function TestComponent({ actor, online }: { actor: string; online: boolean }) {
    useReceiptQueueReplay(actor, online);
    return <div>ReceiptReplayRunner</div>;
  }

  it("flushes a receipt persisted after the first replay, sending both successive receipts to the transport", async () => {
    // 1. Persist the first receipt while offline or before mounting
    enqueueReceiptAction({
      messageId: "msg-first",
      action: "read",
      queuedAt: new Date().toISOString(),
    });

    expect(readReceiptQueue()).toHaveLength(1);

    // 2. Mount hook in online state -> first replay flushes msg-first
    render(
      <QueryClientProvider client={queryClient}>
        <TestComponent actor="actor@example.com" online={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledWith("msg-first");
    });

    // Verify first receipt was dequeued
    expect(readReceiptQueue()).toHaveLength(0);
    expect(markReadSpy).toHaveBeenCalledTimes(1);

    // 3. Persist a second receipt after the first successful replay
    act(() => {
      enqueueReceiptAction({
        messageId: "msg-second",
        action: "read",
        queuedAt: new Date().toISOString(),
      });
    });

    // 4. Assert that the second receipt is also flushed to the transport
    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledWith("msg-second");
    });

    // Both receipts must have reached the transport
    expect(markReadSpy).toHaveBeenCalledTimes(2);
    expect(markReadSpy).toHaveBeenNthCalledWith(1, "msg-first");
    expect(markReadSpy).toHaveBeenNthCalledWith(2, "msg-second");

    // Queue must now be fully cleared
    expect(readReceiptQueue()).toHaveLength(0);
  });

  it("re-enqueues on transport failure and allows retry on subsequent queue activity", async () => {
    markReadSpy.mockRejectedValueOnce(new Error("Network failure"));

    enqueueReceiptAction({
      messageId: "msg-fail-then-succeed",
      action: "read",
      queuedAt: new Date().toISOString(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TestComponent actor="actor@example.com" online={true} />
      </QueryClientProvider>,
    );

    // Initial attempt fails and re-enqueues
    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledWith("msg-fail-then-succeed");
    });

    expect(readReceiptQueue()).toHaveLength(1);

    // Reset mock to succeed
    markReadSpy.mockResolvedValueOnce({
      messageId: "msg-fail-then-succeed",
      sender: "sender@example.com",
      recipient: "actor@example.com",
      deliveredAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
      chainStatus: "confirmed",
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("stealth:receipt-enqueued"));
    });

    await waitFor(() => {
      expect(markReadSpy).toHaveBeenCalledTimes(2);
    });

    expect(readReceiptQueue()).toHaveLength(0);
  });
});
