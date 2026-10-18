import { Sparkles } from "lucide-react";

import type { Email } from "./data";
import { cn } from "@/lib/utils";

type SenderAvatarSize = "sm" | "md" | "lg";

const sizeClasses: Record<SenderAvatarSize, string> = {
  sm: "h-7 w-7 text-[9px]",
  md: "h-[30px] w-[30px] text-[10px]",
  lg: "h-9 w-9 text-[11px]",
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function identiconDataUri(seed: string, color: string): string {
  const grid = 5;
  const cell = 10;
  const size = grid * cell;
  const hash = hashString(seed);
  const rects: string[] = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < Math.ceil(grid / 2); x++) {
      const bit = (y * grid + x) % 32;
      if ((hash >>> bit) & 1) {
        rects.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`);
        const mirror = grid - 1 - x;
        if (mirror !== x) {
          rects.push(`<rect x="${mirror * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`);
        }
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><g fill="${color}">${rects.join("")}</g></svg>`;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
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

  const seed = email.from.toLowerCase();

  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full text-white/95 ring-1 ring-surface-tint/15 shadow-[0_8px_18px-12px_rgba(0,0,0,0.9)]",
        sizeClasses[size],
        className,
      )}
      style={{
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.3), transparent 25%), linear-gradient(135deg, ${email.avatarColor}, #1a1a1d 88%)`,
      }}
      aria-label={`${email.from} avatar`}
    >
      <Sparkles className="absolute h-[58%] w-[58%] opacity-25" aria-hidden />
      <span className="relative font-semibold tracking-tight">{initials}</span>
      <img
        src={identiconDataUri(seed, email.avatarColor)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
      />
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand-highlight ring-2 ring-background" />
      ) : null}
    </div>
  );
}
