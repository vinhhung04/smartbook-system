import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { authService } from "@/services/auth";
import { canAccess } from "@/lib/rbac";
import { navGroups } from "@/lib/nav-groups";
import { useI18n } from "@/lib/i18n";
import { onCommandPaletteOpen } from "@/lib/command-palette-bus";

interface PaletteResult {
  to: string;
  labelKey: string;
  groupLabelKey: string;
  icon: (typeof navGroups)[number]["items"][number]["icon"];
  iconBg: string;
  textColor: string;
}

// Finds every screen the current user can actually open — reusing the exact same
// canAccess() filter as the sidebar, so a result here can never dead-end at
// /forbidden. Navigation-only for now: it searches screen names across the ~40
// pages behind the sidebar, not book/order content — see command_palette.search_placeholder.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { t } = useI18n();

  // Reset query/selection when the palette opens or the query changes — adjusted
  // during render (React's documented pattern for this) rather than in an effect,
  // which would call setState synchronously and risk a cascading re-render.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevQuery, setPrevQuery] = useState(query);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  } else if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  // Recomputed every render, same as sidebar.tsx's visibleGroups — cheap enough
  // (~40 items) that memoizing it isn't worth the extra dependency bookkeeping.
  const user = authService.getCurrentUser();
  const allResults: PaletteResult[] = navGroups.flatMap((group) =>
    group.items
      .filter((item) => canAccess(user, item.access))
      .map((item) => ({
        to: item.to,
        labelKey: item.labelKey,
        groupLabelKey: group.labelKey,
        icon: item.icon,
        iconBg: item.iconBg,
        textColor: item.textColor,
      })),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allResults;
    return allResults.filter((result) => t(result.labelKey).toLowerCase().includes(q));
  }, [allResults, query, t]);

  const groupedResults = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, PaletteResult[]>();
    filtered.forEach((result) => {
      if (!byGroup.has(result.groupLabelKey)) {
        byGroup.set(result.groupLabelKey, []);
        order.push(result.groupLabelKey);
      }
      byGroup.get(result.groupLabelKey)!.push(result);
    });
    return order.map((groupLabelKey) => ({ groupLabelKey, items: byGroup.get(groupLabelKey)! }));
  }, [filtered]);

  useEffect(() => onCommandPaletteOpen(() => setOpen((prev) => !prev)), []);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (modifierPressed && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const goTo = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) goTo(target.to);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="fixed left-1/2 top-[12%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl shadow-black/20 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">{t("command_palette.title")}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t("command_palette.description")}</DialogPrimitive.Description>

          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t("command_palette.search_placeholder")}
              className="h-12 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
              Esc
            </kbd>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-2">
            {groupedResults.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">{t("command_palette.no_results")}</p>
            ) : (
              groupedResults.map((group) => (
                <div key={group.groupLabelKey} className="mb-1 last:mb-0">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {t(group.groupLabelKey)}
                  </p>
                  {group.items.map((item) => {
                    const globalIndex = filtered.indexOf(item);
                    const isActive = globalIndex === activeIndex;
                    return (
                      <button
                        key={item.to}
                        type="button"
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        onClick={() => goTo(item.to)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                          isActive
                            ? "bg-accent text-accent-foreground ring-1 ring-inset ring-primary/40"
                            : "text-foreground hover:bg-accent/60"
                        }`}
                      >
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${item.iconBg}`}>
                          <item.icon className={`h-3.5 w-3.5 ${item.textColor}`} />
                        </div>
                        <span className="flex-1 truncate" style={{ fontWeight: isActive ? 550 : 400 }}>
                          {t(item.labelKey)}
                        </span>
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3" />
              <ArrowDown className="h-3 w-3" /> {t("command_palette.navigate")}
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> {t("command_palette.open")}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
