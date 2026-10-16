import { Sparkles } from "lucide-react";

import type { Email } from "./data";
import { cn } from "@/lib/utils";

type SenderAvatarSize = "sm" | "md" | "lg";

const sizeClasses: Record<SenderAvatarSize, string> = {
  sm: "h-7 w-7 text-[9px]",
  md: "h-[30px] w-[30px] text-[10px]",
  lg: "h-9 w-9 text-[11px]",
};

const IDENTICON_PALETTE = [
  "#10b981",
  "#38bdf8",
  "#818cf8",
  "#f59e0b",
  "#f43f5e",
  "#a855f7",
  "#14b8a6",
  "#eab308",
];

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Generates a deterministic local SVG identicon data URI from a sender seed
 * without making any network request to a third-party avatar service.
 */
export function buildLocalIdenticonDataUri(seed: string, accentColor?: string): string {
  const normalized = (seed || "anonymous").trim().toLowerCase();
  const hash = hashSeed(normalized);
  const fg = accentColor || IDENTICON_PALETTE[hash % IDENTICON_PALETTE.length];
  const cells: string[] = [];

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const bitIndex = row * 3 + col;
      const filled = ((hash >>> (bitIndex % 24)) & 1) === 1;
      if (filled) {
        cells.push(`<rect x="${col}" y="${row}" width="1" height="1" fill="${fg}" fill-opacity="0.28"/>`);
        const mirrorCol = 4 - col;
        if (mirrorCol !== col) {
          cells.push(
            `<rect x="${mirrorCol}" y="${row}" width="1" height="1" fill="${fg}" fill-opacity="0.28"/>`,
          );
        }
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" shape-rendering="crispEdges"><rect width="5" height="5" fill="#1a1a1d"/>${cells.join("")}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function SenderAvatar({
  email,
  size = "sm",
  unread = false,
  className,
}: {
  email: Email;
  size?: SenderAvatarSize;
  unread?: boolean;
  className?: string;
}) {
  const initials = email.from
    .split(/\s+/)
    .map((name) => name[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const seed = email.email || email.from;
  const identiconSrc = buildLocalIdenticonDataUri(seed, email.avatarColor);

  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full text-white/95 ring-1 ring-surface-tint/15 shadow-[0_8px_18px_-12px_rgba(0,0,0,0.9)]",
        sizeClasses[size],
        className,
      )}
      style={{
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.3), transparent 25%), linear-gradient(135deg, ${email.avatarColor}, #1a1a1d 88%)`,
      }}
      aria-label={`${email.from} avatar`}
    >
      <img
        src={identiconSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <Sparkles className="absolute h-[58%] w-[58%] opacity-25" aria-hidden />
      <span className="relative font-semibold tracking-tight">{initials}</span>
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand-highlight ring-2 ring-background" />
      ) : null}
    </div>
  );
}
