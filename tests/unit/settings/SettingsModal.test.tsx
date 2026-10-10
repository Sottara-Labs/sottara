/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultLayoutPreferences, defaultPreferences } from "@/features/preferences";
import { SettingsModal } from "@/components/mail/SettingsModal";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: () => ({ mutateAsync: vi.fn(), isError: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/features/changelog", () => ({
  ChangelogPanel: () => <div>Release notes panel</div>,
  useChangelog: () => ({ hasUnread: false }),
}));
vi.mock("@/features/audit-log", () => ({ AuditLog: () => <div>Audit log panel</div> }));
vi.mock("@/features/settings/external-wallet-linking", () => ({
  ExternalWalletSettings: () => <div>External wallet panel</div>,
}));
vi.mock("@/features/settings/ManagedWalletStatus", () => ({
  ManagedWalletStatus: () => <div>Managed wallet panel</div>,
}));
vi.mock("@/features/settings/recovery-codes", () => ({
  RecoveryCodesSection: () => <div>Recovery codes panel</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(overrides: Partial<React.ComponentProps<typeof SettingsModal>> = {}) {
  const props: React.ComponentProps<typeof SettingsModal> = {
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
  return { ...render(<SettingsModal {...props} />), props };
}

describe("SettingsModal dialog", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it("renders nothing while closed and exposes an accessible dialog when open", () => {
    const { rerender } = renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <SettingsModal
        open
        onClose={vi.fn()}
        preferences={defaultPreferences}
        onChange={vi.fn()}
        layout={defaultLayoutPreferences}
        onLayoutChange={vi.fn()}
        onResetLayout={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("dismisses on Escape and switches the visible panel from the sections tablist", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("Appearance");
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("prefers onCancel for cancel and Escape, and saves before closing", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    const onSave = vi.fn();
    renderModal({ onCancel, onClose, onSave });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to onClose when no cancel callback is supplied", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
