import { useState, type ReactNode } from "react";
import type { IsbnSourceName } from "@/services/ai";
import { SOURCE_KIND_META, sourceKind } from "./source-meta";

/** Sources with a logo in public/source-logos/: 128px PNGs cut from each site's
 *  own icon, either edge to edge (solid app icons) or a centred mark on transparency. */
const LOGO_SOURCES = new Set<IsbnSourceName>([
  "googleBooks", "openLibrary", "loc", "dnb", "ppdvn", "fahasa", "tiki", "nhanam", "dinhTi", "thaiHa", "vanLang",
  "ipm", "kimDong", "azVietnam", "omegaPlus", "tanViet", "alphaBooks", "phuongNam", "nhanVan", "minhLong", "bizbooks",
]);

function sourceLogoUrl(source: IsbnSourceName): string | null {
  if (source === "catalog") return `${import.meta.env.BASE_URL}favicon.svg`;
  return LOGO_SOURCES.has(source) ? `${import.meta.env.BASE_URL}source-logos/${source}.png` : null;
}

const SIZE = {
  xs: { tile: "h-[22px] w-[22px] rounded-[6px]", icon: "h-3.5 w-3.5", inset: "p-[3px]" },
  md: { tile: "h-8 w-8 rounded-[9px]", icon: "h-4 w-4", inset: "p-1" },
  lg: { tile: "h-10 w-10 rounded-[11px]", icon: "h-5 w-5", inset: "p-1" },
} as const;

/**
 * A source's identity tile: its own logo on white (logos are drawn for light
 * backgrounds, so the tile stays white in dark mode too). `muted` greys it out for
 * sources that were not asked; the group-hover/focus of the nearest `.group/source`
 * brings the colour back. Web/AI search, or a logo that fails to load, shows the
 * source-kind icon instead. `badge` sits on the bottom-right corner.
 */
export function SourceLogo({ source, size, muted = false, badge }: {
  source: IsbnSourceName; size: keyof typeof SIZE; muted?: boolean; badge?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : sourceLogoUrl(source);
  const s = SIZE[size];
  const Icon = SOURCE_KIND_META[sourceKind(source)].icon;
  const tone = muted
    ? "grayscale opacity-70 group-hover/source:grayscale-0 group-hover/source:opacity-100 group-focus-visible/source:grayscale-0 group-focus-visible/source:opacity-100"
    : "";
  return (
    <span className="relative inline-flex shrink-0" aria-hidden="true">
      <span className={`grid place-items-center overflow-hidden ring-1 ring-inset transition-[filter,opacity] duration-200 motion-reduce:transition-none ${s.tile} ${tone} ${
        url ? "bg-white ring-black/[0.08] shadow-[0_1px_2px_rgb(15_23_42/0.08)] dark:ring-white/10" : "bg-muted text-muted-foreground ring-border"}`}>
        {url
          ? <img src={url} alt="" width={128} height={128} decoding="async" draggable={false}
              className={`h-full w-full object-contain ${source === "catalog" ? s.inset : ""}`} onError={() => setFailed(true)} />
          : <Icon className={`${s.icon} ${source === "aiWebSearch" ? "text-[#1d5fbf] dark:text-[#8ab4f8]" : ""}`} />}
      </span>
      {badge ? <span className="absolute -bottom-1 -right-1 grid place-items-center rounded-full ring-2 ring-card">{badge}</span> : null}
    </span>
  );
}
