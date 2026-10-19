// ------------------------------------------------------------------------------
// Issue #1972 (BETA-065) — Server-Backed Mailbox Search Component
//
// Interactive topbar search input with:
// - Privacy-safe metadata indexing notice
// - Debounced live search over server metadata + client decrypted local index
// - Quick filter chips (unread, attachments, date, folder)
// - Recent search history controls (add, remove single, clear all)
// - Highlighted text matching for keywords
// - Skeletons, error/offline recovery, empty states
// - Keyboard navigation (ArrowUp/Down, Enter, Esc), ARIA live announcements
// ------------------------------------------------------------------------------

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Command,
  X,
  History,
  Check,
  AlertCircle,
  RefreshCw,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  SearchIcon as Search,
  ProofIcon as ShieldCheck,
  AllMailIcon as Mail,
  IdentityIcon as User,
  DraftIcon as FileText,
  FilesIcon as Paperclip,
  CalendarIcon as Calendar,
} from "@/features/design-system/components/mail-icons";

import type { Email } from "./data";
import { cn } from "@/lib/utils";
import { useMailSearch } from "@/features/mail/useMailSearch";
import type { SearchResultItemDto } from "@/lib/api";

export interface TopbarSearchProps {
  actor?: string | null;
  emails?: Email[];
  onOpenPalette: () => void;
  onSelectEmail?: (emailId: string, folder?: string) => void;
}

/**
 * Renders text with search keyword matches wrapped in a highlight `<mark>`.
 */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <span>{text}</span>;

  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !t.includes(":"));

  if (tokens.length === 0) return <span>{text}</span>;

  // Escape tokens for regex
  const escapedTokens = tokens.map((t) => t.replace(/[.*+??^${}()|[\]\\\\]/g, "\\$&"));
  const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) => {
        const isMatch = tokens.some((t) => t.toLowerCase() === part.toLowerCase());
        return isMatch ? (
          <mark
            key={i}
            className="rounded-[2px] bg-primary/25 px-0.5 font-medium text-foreground text-inherit"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </span>
  );
}

export function TopbarSearch({
  actor = null,
  emails = [],
  onOpenPalette,
  onSelectEmail,
}: TopbarSearchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const search = useMailSearch({
    actor,
    emails,
    onSelectEmail,
  });

  const {
    rawQuery,
    setRawQuery,
    debouncedQuery,
    filters,
    setFilters,
    isOpen,
    setIsOpen,
    history,
    removeHistory,
    clearHistory,
    results,
    isLoading,
    isError,
    error,
    retry,
    handleSelectResult,
    handleSelectHistoryItem,
  } = search;

  // Update positioning of dropdown when opened or on window resize
  useLayoutEffect(() => {
    if (isOpen && containerRef.current) {
      setDropdownRect(containerRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      if (containerRef.current) {
        setDropdownRect(containerRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  // Click outside listener to close search dropdown
  useEffect(() => {
    if (!isOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [isOpen, setIsOpen]);

  // Keyboard navigation inside search dropdown
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const maxItems = results.length > 0 ? results.length : history.length;
      if (maxItems > 0) {
        setActiveIndex((prev) => (prev + 1) % maxItems);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) return;
      const maxItems = results.length > 0 ? results.length : history.length;
      if (maxItems > 0) {
        setActiveIndex((prev) => (prev <= 0 ? maxItems - 1 : prev - 1));
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      return;
    }

    if (e.key === "Enter") {
      if (isOpen && activeIndex >= 0) {
        e.preventDefault();
        if (results.length > 0 && results[activeIndex]) {
          handleSelectResult(results[activeIndex]);
        } else if (history.length > 0 && history[activeIndex]) {
          handleSelectHistoryItem(history[activeIndex]);
        }
      } else if (rawQuery.trim()) {
        search.addHistory(rawQuery.trim());
      }
    }
  };

  const isQueryActive =
    Boolean(rawQuery.trim()) || Object.values(filters).some((v) => v !== undefined);

  return (
    <div
      ref={containerRef}
      className="relative flex h-9 min-w-[220px] flex-[1_1_320px] items-center lg:max-w-[460px]"
    >
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls="search-dropdown-panel"
        aria-label="Search messages, contacts, and drafts"
        value={rawQuery}
        onChange={(e) => {
          setRawQuery(e.target.value);
          if (!isOpen) setIsOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          setIsOpen(true);
          if (containerRef.current) {
            setDropdownRect(containerRef.current.getBoundingClientRect());
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search messages, contacts, drafts (e.g. from:alice is:unread)..."
        className="glow-ring h-9 w-full min-w-0 rounded-md border border-surface-tint/[0.07] bg-surface-tint/[0.035] pl-9 pr-20 text-[13px] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] placeholder:text-muted-foreground/70 transition focus:bg-surface-tint/[0.06]"
      />

      <div className="absolute right-1.5 flex items-center gap-1">
        {rawQuery && (
          <button
            type="button"
            aria-label="Clear search text"
            onClick={() => {
              setRawQuery("");
              setFilters({});
              inputRef.current?.focus();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition hover:bg-surface-tint/10 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          aria-label="Open command palette"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(false);
            onOpenPalette();
          }}
          className="flex items-center gap-1 rounded border border-surface-tint/10 bg-surface-recessed/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-surface-tint/20 hover:text-foreground"
        >
          <Command className="h-3 w-3" /> K
        </button>
      </div>

      {/* Screen Reader live region */}
      <div className="sr-only" aria-live="polite">
        {isOpen && isQueryActive
          ? isLoading
            ? "Searching mailbox..."
            : `${results.length} search result${results.length === 1 ? "" : "s"} found.`
          : ""}
      </div>

      {/* Search Dropdown Portal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsOpen(false)}
                  className="fixed inset-0 z-[100] bg-surface-recessed/30 backdrop-blur-xs"
                />
                <motion.div
                  ref={panelRef}
                  id="search-dropdown-panel"
                  role="listbox"
                  aria-label="Search results and history"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  style={{
                    position: "fixed",
                    top: dropdownRect ? dropdownRect.bottom + 6 : 60,
                    left: dropdownRect
                      ? Math.max(
                          8,
                          Math.min(
                            dropdownRect.left,
                            typeof window !== "undefined"
                              ? window.innerWidth -
                                  Math.min(
                                    window.innerWidth - 16,
                                    Math.max(280, dropdownRect.width + 80),
                                  ) -
                                  8
                              : 8,
                          ),
                        )
                      : 8,
                    width: dropdownRect
                      ? Math.min(
                          typeof window !== "undefined" ? window.innerWidth - 16 : 420,
                          Math.max(280, dropdownRect.width + 80),
                        )
                      : Math.min(typeof window !== "undefined" ? window.innerWidth - 16 : 420, 420),
                    maxHeight: "calc(100vh - 80px)",
                    zIndex: 110,
                  }}
                  className="glass-modal flex flex-col overflow-hidden rounded-xl border border-surface-tint/10 bg-surface-recessed/90 p-0 shadow-2xl backdrop-blur-2xl"
                >
                  {/* Privacy-Safe Notice Banner */}
                  <div className="flex items-center gap-2 border-b border-surface-tint/[0.06] bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>
                      <strong className="font-medium text-foreground">Privacy-Safe Index:</strong>{" "}
                      Server indexes headers & metadata. Unlocked message bodies are searched
                      locally.
                    </span>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
        )}
    </div>
  );
}
