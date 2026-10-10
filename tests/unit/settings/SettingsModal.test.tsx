/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { defaultLayoutPreferences, defaultPreferences } from "@/features/preferences";
import { sharedTypedApi } from "@/lib/api";
import { SettingsModal } from "@/components/mail/SettingsModal";

// framer-motion drives the dialog shell (AnimatePresence + motion.div). Strip it
// to plain elements so the tests assert DOM contract, not animation behavior.
vi.mock("framer-motion", async () => {
  const { Fragment, jsx } = await import("react/jsx-runtime");
  const { forwardRef } = await import("react");
  const MotionDiv = forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
    const { initial, animate, exit, transition, ...rest } = props;
    return jsx("div", { ...rest, ref });
  });
  MotionDiv.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => jsx(Fragment, { children }),
    motion: { div: MotionDiv },
    useReducedMotion: () => true,
  };
});

// Keep the suite hermetic: the contract under test is the dialog shell
// (rendering, tabs, keyboard, cancel/save), not the feature panels.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    sharedTypedApi: {
      account: { getProfile: vi.fn(), updateProfile: vi.fn() },
      policies: { getReconciliation: vi.fn(), update: vi.fn() },
    },
  };
});

vi.mock("@/features/changelog", async () => {
  const { jsx } = await import("react/jsx-runtime");
  return {
    useChangelog: () => ({ hasUnread: false }),
    ChangelogPanel: () => jsx("div", { "data-testid": "changelog-panel" }),
  };
});

vi.mock("@/features/audit-log", async () => {
  const { jsx } = await import("react/jsx-runtime");
  return { AuditLog: () => jsx("div", { "data-testid": "audit-log-panel" }) };
});

vi.mock("@/features/settings/external-wallet-linking", () => ({
  ExternalWalletSettings: () => null,
}));

vi.mock("@/features/settings/ManagedWalletStatus", () => ({
  ManagedWalletStatus: () => null,
}));

vi.mock("@/features/settings/recovery-codes", () => ({
  RecoveryCodesSection: () => null,
}));

vi.mock("@/features/notifications", () => ({
  requestBrowserPermission: vi.fn(),
  safeBrowserCopy: { mail: { title: "Test", body: "Test body" } },
}));

const profilePayload = {
  profile: {
    displayName: "Test User",
    username: "testuser",
    bio: "Just a test",
    locale: "en",
    timezone: "UTC",
    avatarUrl: null,
    addressDisplay: "truncated",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notifications: { email: true, desktop: true, sound: false },
  },
  account: {
    email: "test@example.com",
    address: "GTESTADDRESS",
    status: "active",
    network: "testnet",
    createdAt: "2025-06-01T00:00:00.000Z",
    betaLimitations: [],
  },
};

type ModalProps = Parameters<typeof SettingsModal>[0];

function renderModal(overrides: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    open: true,
    onClose: vi.fn(),
    preferences: defaultPreferences,
    onChange: vi.fn(),
    layout: defaultLayoutPreferences,
    onLayoutChange: vi.fn(),
    onResetLayout: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SettingsModal {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, props };
}

describe("SettingsModal (issue #104)", () => {
  beforeEach(() => {
    vi.mocked(sharedTypedApi.account.getProfile).mockResolvedValue(profilePayload as never);
    vi.mocked(sharedTypedApi.account.updateProfile).mockResolvedValue({} as never);
    vi.mocked(sharedTypedApi.policies.getReconciliation).mockResolvedValue({
      offchain: {
        policy: { allowUnknown: true, requireVerified: false, minimumPostage: "0.0001" },
      },
      state: "idle",
    } as never);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders nothing when open is false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.getElementById("settings-dialog")).toBeNull();
  });

  it("exposes role=dialog labelled by settings-title when open", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-labelledby", "settings-title");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.getElementById("settings-title")).not.toBeNull();
  });

  it("loads the default account panel from the profile query", async () => {
    renderModal();
    const matches = await screen.findAllByText("Test User");
    expect(matches.length).toBeGreaterThan(0);
    expect(sharedTypedApi.account.getProfile).toHaveBeenCalled();
  });

  it("invokes the dismiss callback on Escape", async () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("falls back to onClose on Escape when onCancel is not provided", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses via the header close button through onCancel ?? onClose", async () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCancel, onClose });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("switches the visible panel when a Settings sections tab is activated", async () => {
    renderModal();
    await screen.findByRole("dialog");
    const tablist = screen.getByRole("tablist", { name: "Settings sections" });
    const accountTab = within(tablist).getByRole("tab", { name: "Account" });
    const appearanceTab = within(tablist).getByRole("tab", { name: "Appearance" });
    expect(accountTab).toHaveAttribute("aria-selected", "true");

    fireEvent.click(appearanceTab);

    expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    expect(accountTab).toHaveAttribute("aria-selected", "false");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "settings-panel-appearance");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-appearance");
  });

  it("cancel calls onCancel when supplied", async () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCancel, onClose });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancel falls back to onClose when onCancel is omitted", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("save invokes onSave and then onClose", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSave, onClose });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });
});
