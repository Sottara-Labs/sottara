/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "@/lib/useFocusTrap";

function Harness({ active, onClose }: { active: boolean; onClose: () => void }) {
  const containerRef = useFocusTrap(active, onClose);
  return (
    <div>
      <button type="button">outside</button>
      <div ref={containerRef} data-testid="trap" tabIndex={-1}>
        <button type="button">first</button>
        <button type="button">middle</button>
        <button type="button">last</button>
      </div>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("focuses the first focusable child when the trap activates", () => {
    render(<Harness active onClose={vi.fn()} />);
    expect(screen.getByText("first")).toBe(document.activeElement);
  });

  it("wraps Tab from the last element to the first", () => {
    render(<Harness active onClose={vi.fn()} />);
    screen.getByText("last").focus();
    expect(document.activeElement).toBe(screen.getByText("last"));

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    render(<Harness active onClose={vi.fn()} />);
    screen.getByText("first").focus();
    expect(document.activeElement).toBe(screen.getByText("first"));

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("does not move focus for Tab in the middle of the trap", () => {
    render(<Harness active onClose={vi.fn()} />);
    screen.getByText("middle").focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByText("middle"));
  });

  it("invokes onClose when Escape is pressed while active", () => {
    const onClose = vi.fn();
    render(<Harness active onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves focus and onClose untouched when the trap is inactive", () => {
    const onClose = vi.fn();
    render(<Harness active={false} onClose={onClose} />);
    screen.getByText("outside").focus();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Tab" });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByText("outside"));
  });

  it("does not steal focus on mount when inactive", () => {
    render(<Harness active={false} onClose={vi.fn()} />);
    expect(screen.getByText("outside")).not.toBe(document.activeElement);
  });

  it("restores focus to the previously focused element on deactivate", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness active={false} onClose={onClose} />);
    screen.getByText("outside").focus();
    expect(document.activeElement).toBe(screen.getByText("outside"));

    rerender(<Harness active onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByText("first"));

    rerender(<Harness active={false} onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByText("outside"));
  });

  it("keeps focus in the dialog across a parent re-render", () => {
    function RerenderingHarness({ active }: { active: boolean }) {
      const [renders, setRenders] = useState(0);
      const containerRef = useFocusTrap(active, () => {});

      return (
        <div>
          <button type="button">outside</button>
          <button type="button" onClick={() => setRenders((count) => count + 1)}>
            rerender {renders}
          </button>
          <div ref={containerRef} data-testid="trap" tabIndex={-1}>
            <button type="button">first</button>
            <button type="button">middle</button>
            <button type="button">last</button>
          </div>
        </div>
      );
    }

    const { rerender } = render(<RerenderingHarness active={false} />);
    screen.getByText("outside").focus();
    expect(document.activeElement).toBe(screen.getByText("outside"));

    rerender(<RerenderingHarness active />);
    expect(document.activeElement).toBe(screen.getByText("first"));

    screen.getByText("middle").focus();

    fireEvent.click(screen.getByText(/rerender/));

    expect(document.activeElement).toBe(screen.getByText("middle"));
  });

  it("invokes the latest onClose after a re-render", () => {
    const closes: number[] = [];

    function RerenderingHarness() {
      const [renders, setRenders] = useState(0);
      const containerRef = useFocusTrap(true, () => closes.push(renders));

      return (
        <div>
          <button type="button" onClick={() => setRenders((count) => count + 1)}>
            rerender {renders}
          </button>
          <div ref={containerRef} data-testid="trap" tabIndex={-1}>
            <button type="button">first</button>
          </div>
        </div>
      );
    }

    render(<RerenderingHarness />);
    fireEvent.click(screen.getByText(/rerender/));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closes).toEqual([1]);
  });
});
