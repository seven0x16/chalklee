import { useId } from "react";
import { Blocks, FileText, ShoppingBasket } from "lucide-react";
import { DatabaseSearch } from "./lucideBackports";

const SPARKLE_STAR = "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z";

export type RailSection = "ai" | "documents" | "library" | "plugins" | "basket";

/** Activity-rail section icon. Places and panels keep the plain lucide outline in both states — the button's tinted card marks the current one; only the assistant's star keeps its theme gradient while off, which sets it apart from the plain icons. */
export function RailSectionIcon({ section, size = 20 }: { section: RailSection; size?: number }) {
  const gradientId = useId();
  if (section !== "ai") {
    if (section === "documents") return <FileText size={size} />;
    if (section === "library") return <DatabaseSearch size={size} />;
    if (section === "plugins") return <Blocks size={size} />;
    return <ShoppingBasket size={size} />;
  }
  return (
    <svg className="rail-section-icon is-filled" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <defs>
        {/* The star runs from the spark hue at the top right into the deep accent, so it meets the spark beside it. */}
        <linearGradient id={gradientId} x1="1" y1="0" x2="0" y2="1">
          <stop offset=".25" stopColor="var(--cm-theme-spark)" />
          <stop offset=".6" stopColor="var(--cm-theme-spark-body)" />
          <stop offset="1" stopColor="var(--cm-theme-accent-strong)" />
        </linearGradient>
      </defs>
      <g>
        <path fill={`url(#${gradientId})`} d={SPARKLE_STAR} />
      </g>
      <path stroke="var(--cm-theme-spark)" strokeWidth="2" strokeLinecap="round" d="M20 3v4M22 5h-4" />
    </svg>
  );
}
