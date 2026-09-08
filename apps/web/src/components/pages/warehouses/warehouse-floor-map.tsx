import { motion } from "motion/react";
import { LayoutGrid } from "lucide-react";
import type { LocationNode } from "@/services/warehouse";
import { EmptyState } from "@/components/ui/empty-state";

interface OccupancyBand {
  key: "empty" | "healthy" | "filling" | "full" | "overflow";
  ratio: number;
  label: string;
  ink: string;
  wash: string;
  line: string;
}

function occupancyBand(available: number | null | undefined, capacity: number | null | undefined): OccupancyBand | null {
  if (!capacity || capacity <= 0) return null;
  const raw = Math.max(0, available ?? 0) / capacity;

  if (raw <= 0) {
    return { key: "empty", ratio: 0, label: "Trống", ink: "text-muted-foreground", wash: "bg-muted", line: "bg-border" };
  }
  if (raw > 1) {
    return { key: "overflow", ratio: 1, label: "Vượt sức chứa", ink: "text-destructive", wash: "bg-destructive/15", line: "bg-destructive" };
  }
  if (raw >= 0.85) {
    return { key: "full", ratio: raw, label: "Gần đầy", ink: "text-destructive", wash: "bg-destructive/10", line: "bg-destructive" };
  }
  if (raw >= 0.6) {
    return { key: "filling", ratio: raw, label: "Đang đầy dần", ink: "text-warning", wash: "bg-warning/10", line: "bg-warning" };
  }
  return { key: "healthy", ratio: raw, label: "Còn chỗ", ink: "text-success", wash: "bg-success/10", line: "bg-success" };
}

const LEGEND_ITEMS: Array<{ label: string; wash: string; line: string }> = [
  { label: "Trống", wash: "bg-muted", line: "bg-border" },
  { label: "Còn chỗ", wash: "bg-success/10", line: "bg-success" },
  { label: "Đang đầy dần", wash: "bg-warning/10", line: "bg-warning" },
  { label: "Gần đầy / vượt sức chứa", wash: "bg-destructive/10", line: "bg-destructive" },
];

function countCompartments(shelves: LocationNode[]): { total: number; measured: number; avgRatio: number } {
  let total = 0;
  let measured = 0;
  let ratioSum = 0;
  shelves.forEach((shelf) => {
    (shelf.children || []).forEach((bin) => {
      total += 1;
      const band = occupancyBand(bin.available, bin.capacity_qty);
      if (band) {
        measured += 1;
        ratioSum += band.ratio;
      }
    });
  });
  return { total, measured, avgRatio: measured > 0 ? ratioSum / measured : 0 };
}

interface WarehouseFloorMapProps {
  zones: LocationNode[];
  selectedLocationId: string;
  onSelectLocation: (id: string) => void;
}

export function WarehouseFloorMap({ zones, selectedLocationId, onSelectLocation }: WarehouseFloorMapProps) {
  if (zones.length === 0) {
    return (
      <EmptyState
        variant="no-data"
        title="Chưa có khu vực nào"
        description="Sơ đồ kho hiển thị khi kho có ít nhất một khu vực gốc."
        className="py-10"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">Mức lấp đầy:</span>
        {LEGEND_ITEMS.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`relative h-3 w-3 shrink-0 overflow-hidden rounded-[3px] border border-border ${item.wash}`}>
              <span className={`absolute inset-x-0 top-0 h-[2px] ${item.line}`} />
            </span>
            {item.label}
          </span>
        ))}
      </div>

      {zones.map((zone, index) => (
        <ZoneBlock
          key={zone.id}
          zone={zone}
          index={index}
          selectedLocationId={selectedLocationId}
          onSelectLocation={onSelectLocation}
        />
      ))}
    </div>
  );
}

function ZoneBlock({
  zone,
  index,
  selectedLocationId,
  onSelectLocation,
}: {
  zone: LocationNode;
  index: number;
  selectedLocationId: string;
  onSelectLocation: (id: string) => void;
}) {
  const shelves = zone.children || [];
  const stats = countCompartments(shelves);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15) }}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center shrink-0">
            <LayoutGrid className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
          </div>
          <p className="text-[13px] font-semibold truncate">Khu vực {zone.zone || zone.name || zone.code}</p>
        </div>
        {stats.total > 0 && (
          <p className="text-[11px] text-muted-foreground shrink-0">
            {stats.total} ngăn kệ · lấp đầy trung bình {Math.round(stats.avgRatio * 100)}%
          </p>
        )}
      </div>

      {shelves.length === 0 ? (
        <p className="text-[12px] text-muted-foreground py-2">Khu vực này chưa có kệ nào.</p>
      ) : (
        <div className="space-y-2.5">
          {shelves.map((shelf) => (
            <AisleRow key={shelf.id} shelf={shelf} selectedLocationId={selectedLocationId} onSelectLocation={onSelectLocation} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function AisleRow({
  shelf,
  selectedLocationId,
  onSelectLocation,
}: {
  shelf: LocationNode;
  selectedLocationId: string;
  onSelectLocation: (id: string) => void;
}) {
  const bins = shelf.children || [];

  return (
    <div className="flex items-stretch gap-3">
      <div className="w-16 shrink-0 flex items-center">
        <span className="text-[11px] font-medium text-muted-foreground truncate">
          Kệ {shelf.aisle || shelf.shelf || shelf.name || shelf.code}
        </span>
      </div>
      {bins.length === 0 ? (
        <p className="flex-1 flex items-center text-[11px] italic text-muted-foreground">chưa có ngăn kệ</p>
      ) : (
        <div className="flex-1 grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
          {bins.map((bin) => (
            <CompartmentTile
              key={bin.id}
              node={bin}
              isSelected={selectedLocationId === bin.id}
              onSelect={() => onSelectLocation(bin.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompartmentTile({
  node,
  isSelected,
  onSelect,
}: {
  node: LocationNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const band = occupancyBand(node.available, node.capacity_qty);
  const label = node.bin || node.code;
  const fraction = band ? `${node.available ?? 0}/${node.capacity_qty}` : null;
  const titleParts = [node.code];
  if (band) titleParts.push(`${band.label} — ${fraction}`);

  return (
    <button
      type="button"
      onClick={onSelect}
      title={titleParts.join(" · ")}
      className={`group relative aspect-square rounded-lg border overflow-hidden text-left transition-all ${
        isSelected ? "border-primary ring-2 ring-primary/50" : "border-border hover:border-muted-foreground/40"
      }`}
    >
      {band && (
        <>
          <span
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-300 ${band.wash}`}
            style={{ height: `${band.ratio * 100}%` }}
          />
          {band.ratio > 0 && (
            <span
              className={`absolute inset-x-0 h-[2px] ${band.line}`}
              style={{ bottom: `${band.ratio * 100}%` }}
            />
          )}
        </>
      )}
      <span className="absolute inset-x-1 top-1 truncate font-mono text-[9px] leading-none text-foreground">
        {label}
      </span>
      {fraction && (
        <span className="absolute inset-x-1 bottom-1 text-center text-[9px] font-semibold leading-none text-foreground">
          {fraction}
        </span>
      )}
    </button>
  );
}
