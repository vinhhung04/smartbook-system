import { useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { BookOpen } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { DecisionSection, EvidenceList } from "@/components/ai/decision-card";
import type { AIRecommendation } from "@/services/ai";
import {
  recommendationTier,
  recommendationFactors,
  RECOMMENDATION_TIER_LABEL,
  RECOMMENDATION_TIER_TONE,
} from "@/lib/ai-decision";

function Cover({ title, imageUrl }: { title: string; imageUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={`Bìa sách ${title}`}
        className="h-24 w-16 shrink-0 rounded-md border border-border object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md border border-border bg-muted" aria-hidden="true">
      <BookOpen className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

interface RecommendationCardProps {
  rec: AIRecommendation;
  href: string;
  coverUrl?: string | null;
  /** CTAs supported by the current flow (e.g. "Xem sách", "Thêm yêu thích"). */
  actions?: ReactNode;
}

// The ranking score is shown as a tier ("Rất phù hợp" / "Phù hợp" / "Khám phá
// thêm"), never as a percentage: it is a weighted ranking sum, not a
// probability. "Vì sao" lists only factors the server's breakdown supports.
export function RecommendationCard({ rec, href, coverUrl, actions }: RecommendationCardProps) {
  const tier = recommendationTier(rec.score, rec.tier);
  const factors = recommendationFactors(rec.breakdown, rec.reason_codes);

  return (
    <article className="flex h-full flex-col rounded-xl border border-border bg-card p-4" aria-label={`Gợi ý: ${rec.title}`}>
      <div className="flex gap-3">
        <NavLink to={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
          <Cover title={rec.title} imageUrl={coverUrl} />
        </NavLink>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
            <NavLink to={href} className="rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
              {rec.title}
            </NavLink>
          </h3>
          <p className="truncate text-[13px] text-muted-foreground">{rec.author || "Chưa rõ tác giả"}</p>
          {rec.category && <p className="truncate text-[12px] text-muted-foreground">{rec.category}</p>}
          <StatusBadge label={RECOMMENDATION_TIER_LABEL[tier]} variant={RECOMMENDATION_TIER_TONE[tier]} />
        </div>
      </div>

      {rec.reason && <p className="mt-3 text-[13px] leading-relaxed text-foreground/85">{rec.reason}</p>}

      <div className="mt-auto pt-2">
        {factors.length > 0 && (
          <DecisionSection title="Vì sao gợi ý sách này?" collapsible>
            <EvidenceList items={factors.map((text) => ({ text, tone: "success" as const }))} />
          </DecisionSection>
        )}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </article>
  );
}
