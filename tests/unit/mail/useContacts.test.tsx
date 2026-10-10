// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Contact, ContactCreateInput } from "@/lib/api";
import { sharedTypedApi as api, queryKeys } from "@/lib/api";
import { useContacts, useCreateContact } from "@/features/mail/useContacts";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sharedTypedApi: {
      ...actual.sharedTypedApi,
      contacts: {
        list: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

const actor = "GOWNER";
const contact: Contact = {
  contactId: "contact-1",
  owner: actor,
  name: "Alice",
  address: "alice*betasmail.com",
  canonicalAddress: "alice*betasmail.com",
  trust: "allow",
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};

const contactInput: ContactCreateInput = {
  name: "Alice",
  address: "alice*betasmail.com",
  trust: "allow",
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

describe("contact hooks", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when the actor is absent or disabled", () => {
    const { wrapper } = createWrapper();
    const { result: noActor } = renderHook(() => useContacts(null), { wrapper });
    const { result: disabled } = renderHook(() => useContacts(actor, false), { wrapper });

    expect(noActor.current.fetchStatus).toBe("idle");
    expect(disabled.current.fetchStatus).toBe("idle");
    expect(api.contacts.list).not.toHaveBeenCalled();
  });

  it("fetches the actor contact list through the typed client", async () => {
    vi.mocked(api.contacts.list).mockResolvedValueOnce({
      items: [contact],
      nextCursor: null,
      hasMore: false,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useContacts(actor), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.contacts.list).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    expect(result.current.data?.items).toEqual([contact]);
  });

  it("creates a contact and invalidates the actor contact list", async () => {
    vi.mocked(api.contacts.create).mockResolvedValueOnce(contact);
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateContact(actor), { wrapper });

    act(() => result.current.mutate(contactInput));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.contacts.create).toHaveBeenCalledWith(contactInput);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.contacts.list(actor),
    });
  });
});
