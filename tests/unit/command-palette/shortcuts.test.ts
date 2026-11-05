// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  SHORTCUT_DEFINITIONS,
  SHORTCUTS_BY_COMMAND,
  getShortcutAction,
  isEditableTarget,
} from "../../../src/features/command-palette";

function editableTarget(tagName: string, parentElement: any = null) {
  return {
    tagName,
    isContentEditable: false,
    getAttribute: () => null,
    parentElement,
  };
}

describe("shortcut guards & definitions", () => {
  it("indexes only shortcut definitions that declare a commandId in SHORTCUTS_BY_COMMAND", () => {
    const withCommandId = SHORTCUT_DEFINITIONS.filter((def) => Boolean(def.commandId));
    expect(SHORTCUTS_BY_COMMAND.size).toBe(withCommandId.length);

    for (const def of SHORTCUT_DEFINITIONS) {
      if (def.commandId) {
        expect(SHORTCUTS_BY_COMMAND.get(def.commandId)).toBe(def);
      } else {
        expect([...SHORTCUTS_BY_COMMAND.values()]).not.toContain(def);
      }
    }
  });

  it("treats inputs, textareas, selects, contentEditable, and textboxes as editable", () => {
    expect(isEditableTarget(editableTarget("INPUT") as any)).toBe(true);
    expect(isEditableTarget(editableTarget("TEXTAREA") as any)).toBe(true);
    expect(isEditableTarget(editableTarget("SELECT") as any)).toBe(true);
    expect(
      isEditableTarget({
        tagName: "DIV",
        isContentEditable: true,
        getAttribute: () => null,
        parentElement: null,
      } as any),
    ).toBe(true);
    expect(
      isEditableTarget({
        tagName: "DIV",
        isContentEditable: false,
        getAttribute: (name: string) => (name === "role" ? "textbox" : null),
        parentElement: null,
      } as any),
    ).toBe(true);
  });

  it("returns false for null, undefined, and non-editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget(editableTarget("DIV") as any)).toBe(false);
    expect(isEditableTarget(editableTarget("BUTTON", editableTarget("MAIN")) as any)).toBe(false);
  });

  it("walks up parent elements to find editable ancestors", () => {
    const parent = editableTarget("TEXTAREA");
    const child = editableTarget("SPAN", parent);
    expect(isEditableTarget(child as any)).toBe(true);
  });

  it("suppresses shortcuts while typing in editable fields or when altKey is pressed", () => {
    expect(
      getShortcutAction({
        key: "k",
        ctrlKey: true,
        target: editableTarget("INPUT") as any,
      }),
    ).toBeNull();
    expect(
      getShortcutAction({
        key: "?",
        shiftKey: true,
        target: editableTarget("TEXTAREA") as any,
      }),
    ).toBeNull();
    expect(
      getShortcutAction({
        key: "k",
        ctrlKey: true,
        altKey: true,
        target: null,
      }),
    ).toBeNull();
    expect(
      getShortcutAction({
        key: "e",
        altKey: true,
        target: null,
      }),
    ).toBeNull();
  });

  it("maps all supported global shortcuts outside editable fields", () => {
    expect(getShortcutAction({ key: "k", ctrlKey: true, target: null })).toBe("open-palette");
    expect(getShortcutAction({ key: "K", metaKey: true, target: null })).toBe("open-palette");
    expect(getShortcutAction({ key: "n", metaKey: true, target: null })).toBe("compose");
    expect(getShortcutAction({ key: "N", ctrlKey: true, target: null })).toBe("compose");
    expect(getShortcutAction({ key: "e", target: null })).toBe("archive-thread");
    expect(getShortcutAction({ key: "z", target: null })).toBe("snooze-thread");
    expect(getShortcutAction({ key: "a", target: null })).toBe("approve-sender");
    expect(getShortcutAction({ key: "b", target: null })).toBe("block-sender");
    expect(getShortcutAction({ key: "c", target: null })).toBe("open-calendar");
    expect(getShortcutAction({ key: ",", target: null })).toBe("open-settings");
    expect(getShortcutAction({ key: "?", shiftKey: true, target: null })).toBe("open-shortcuts");
    expect(getShortcutAction({ key: "i", target: null })).toBe("open-proof-inspector");
    expect(getShortcutAction({ key: "x", target: null })).toBeNull();
    expect(getShortcutAction({ key: "e", ctrlKey: true, target: null })).toBeNull();
  });

  it("suppresses global shortcuts when any dialog selector is open in the DOM, except for open-palette", () => {
    const selectors: Array<[string, string]> = [
      ["role", "dialog"],
      ["aria-modal", "true"],
      ["data-state", "open"],
    ];

    for (const [attr, value] of selectors) {
      const dialog = document.createElement("div");
      dialog.setAttribute(attr, value);
      document.body.appendChild(dialog);

      try {
        expect(getShortcutAction({ key: "k", ctrlKey: true, target: null })).toBe("open-palette");
        expect(getShortcutAction({ key: "k", metaKey: true, target: null })).toBe("open-palette");
        expect(getShortcutAction({ key: "n", metaKey: true, target: null })).toBeNull();
        expect(getShortcutAction({ key: "e", target: null })).toBeNull();
        expect(getShortcutAction({ key: "z", target: null })).toBeNull();
        expect(getShortcutAction({ key: "a", target: null })).toBeNull();
        expect(getShortcutAction({ key: "b", target: null })).toBeNull();
        expect(getShortcutAction({ key: "c", target: null })).toBeNull();
        expect(getShortcutAction({ key: "i", target: null })).toBeNull();
        expect(getShortcutAction({ key: "?", shiftKey: true, target: null })).toBeNull();
        expect(getShortcutAction({ key: ",", target: null })).toBeNull();
      } finally {
        document.body.removeChild(dialog);
      }
    }
  });
});
