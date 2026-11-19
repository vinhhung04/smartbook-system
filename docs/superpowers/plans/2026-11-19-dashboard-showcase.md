# /dashboard showcase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (user chose "làm đi": native, in this session). Steps use `- [ ]`.

**Goal:** Turn `/dashboard` into the defence-demo screen: AI risk block, live activity feed, period selector, restrained React Bits–style motion.
**Architecture:** Presentation + two extra reads inside `fetchDashboard`; period-scoped reads (trends, top books) reload on their own. No backend change.
**Tech Stack:** React 18, Tailwind v4 container queries, `motion/react`, recharts 2.15.
**Spec:** `docs/superpowers/specs/2026-11-19-dashboard-showcase-design.md`

## Global Constraints
- No new dependency (`ogl`, React Bits package): rewrite the three effects with `motion`, credit React Bits in a one-line comment.
- Every animation is off under `prefers-reduced-motion`; the final number shown is always the real value.
- Three faces only (Inter, mono for codes, Fraunces via `PageHeader`/`font-display`).
- Borrow-domain blocks (AI risk, activity feed, period selector) render only with `analytics.borrow.read`; `manager01` sees no empty/error block.
- Period options (changed from spec after checking data — "Toàn bộ" returns 300+ empty months): `30 ngày` (day), `90 ngày` (day), `12 tháng` (month). Default `30 ngày`.

## Review Focus
- Month granularity rows (`"2026-10"`) must label as `10/2026`, not raw strings; `zeroFill` must not drop them.
- Risk model `status: 'INSUFFICIENT_DATA'` or empty `items` (no-show has 0 open today) → one quiet sentence, model line still shown when `evaluation` exists.
- Realtime burst: feed keeps at most 8 rows, newest first, no duplicate React keys.
- Refresh (`Làm mới`) must not replay CountUp from 0.
- `/reorder-suggestions?tab=late-return` for a user without `analytics.borrow.read` stays on `reorder`.

---

### Task 1: Shared labels + motion primitives
**Files:** Create `src/components/reorder-intelligence/risk-domains.ts` (move `LATE_RETURN`, `NO_SHOW` from `reorder-suggestions.tsx`); create `src/lib/borrow-audit-labels.ts` (move `ACTION_LABELS` + `actionLabel` from `audit-trail.tsx`); create `src/components/ui/count-up.tsx` → `CountUp({ to: number; format: (n: number) => string; className?: string })`; create `src/components/ui/spotlight.ts` → `spotlightMove(event: React.PointerEvent<HTMLElement>): void` + `SPOTLIGHT_CLASS: string`.
- [ ] Move constants, re-import in both pages; `tsc` clean.
- [ ] CountUp: animates 0→`to` once on mount (0.8 s, easeOut) via `animate`; reduced motion renders `format(to)` directly.
- [ ] Spotlight: sets `--spot-x/--spot-y` on `currentTarget`; class draws a primary radial gradient on hover only.
- [ ] Use both in `kpi-grid.tsx` (`Stat.count?: { to: number; format }`).

### Task 2: AI risk block
**Files:** Create `dashboard/ai-risk-section.tsx` → `AiRiskSection({ late, noShow, canOpen, onRetry })` with `RiskModelData<…> | null`; modify `types.ts` (`lateRisk`, `noShowRisk`), `index.tsx` (`fetchDashboard` adds both with `limit: 5` when `borrow`), `reorder-suggestions.tsx` (initial tab from `?tab=` when allowed).
- [ ] Two columns: row = customer, title, score bar + percent, band chip, strongest factor label; footer model line (trained_at, train_size, AUC).
- [ ] Links: `/reorder-suggestions?tab=late-return|no-show` when `access.reorder`.

### Task 3: Live activity feed
**Files:** Create `dashboard/activity-feed.tsx` → `ActivityFeed({ initial: AuditLog[] | null, live: LiveEvent[], onRetry })`; `index.tsx` loads `GET /borrow/audit-logs?pageSize=8` in `fetchDashboard` (borrow only) and pushes realtime events into `live` (max 8, `AnimatePresence` + `layout`).

### Task 4: Period selector, area chart, header, layout
**Files:** `index.tsx` (period state, separate reload of trends/top books, `PageHeader`), `trend-funnel-section.tsx` (`AreaChart` monotone, month labels), `top-books-fines-section.tsx` (description follows period), `dashboard-skeleton.tsx` (new rows).
- [ ] Layout: row 1 Decision(8)+KPI(4); row 2 AI risk(8)+feed(4); rest unchanged.

### Task 5: Verify
- [ ] `pnpm --filter web exec tsc --noEmit`, eslint on touched files, `npm run -s test:unit`, build.
- [ ] `redesign-backend-smoke` + `fullhd-layout` for `/dashboard` on :5174 (temporary chrome config, deleted after).
- [ ] Screenshots 1440 / 390 / reduced motion as `hung`; check `manager01` view.
