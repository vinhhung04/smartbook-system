import { motion } from "motion/react";
import { LayoutGrid } from "lucide-react";
import type { LocationNode } from "@/services/warehouse";
import { EmptyState } from "@/components/ui/empty-state";
import { occupancyBand } from "./meta";

const numberFormat = new Intl.NumberFormat("vi-VN");

const LEGEND_ITEMS: Array<{ label: string; wash: string; line: string }> = [
  { label: "Trống", wash: "bg-muted", line: "bg-border" },
  { label: "Còn chỗ", wash: "bg-success/10", line: "bg-success" },
  { label: "Đang đầy dần", wash: "bg-warning/10", line: "bg-warning" },
  { label: "Gần đầy / vượt sức chứa", wash: "bg-destructive/10", line: "bg-destructive" },
];

// Fill comes from `occupied_qty` (stock balances, summed by the location endpoint).
function zoneStats(shelves: LocationNode[]): { total: number; capacity: number; occupied: number } {
  let total = 0;
  let capacity = 0;
  let occupied = 0;
  shelves.forEach((shelf) => {
    (shelf.children || []).forEach((bin) => {
      total += 1;
      if (typeof bin.capacity_qty === "number" && bin.capacity_qty > 0) {
        capacity += bin.capacity_qty;
        occupied += bin.occupied_qty ?? 0;
      }
    });
  });
  return { total, capacity, occupied };
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">Mức lấp đầy</span>
        {LEGEND_ITEMS.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
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
  const stats = zoneStats(shelves);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15) }}
      className="border-t border-border pt-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h3 className="truncate font-serif text-[16px] font-semibold tracking-tight">Khu vực {zone.name || zone.code}</h3>
        </div>
        {stats.total > 0 && (
          <p className="shrink-0 text-[12px] text-muted-foreground">
            {stats.total} ngăn kệ{stats.capacity > 0 ? `, đang chứa ${numberFormat.format(stats.occupied)} / ${numberFormat.format(stats.capacity)} cuốn` : ""}
          </p>
        )}
      </div>

      {shelves.length === 0 ? (
        <p className="py-2 text-[12px] text-muted-foreground">Khu vực này chưa có kệ nào.</p>
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
      <div className="flex w-20 shrink-0 items-center">
        <span className="truncate text-[12px] font-medium text-muted-foreground">
          Kệ {shelf.name || shelf.code}
        </span>
      </div>
      {bins.length === 0 ? (
        <p className="flex flex-1 items-center text-[12px] text-muted-foreground">Chưa có ngăn kệ</p>
      ) : (
        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
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
  const label = node.name || node.code;
  // The aisle row already names the shelf, so the tile only needs the last segment ("A / 01 / 03" -> "03").
  const shortLabel = label.split("/").pop()?.trim() || label;
  const capacity = typeof node.capacity_qty === "number" && node.capacity_qty > 0 ? node.capacity_qty : null;
  const occupied = node.occupied_qty ?? 0;
  const band = occupancyBand(occupied, capacity);
  const titleParts = [label, node.code];
  if (capacity) titleParts.push(`đang chứa ${occupied}/${capacity}${band ? ` (${band.label.toLowerCase()})` : ""}`);
  if (node.is_active === false) titleParts.push("ngừng hoạt động");

  return (
    <button
      type="button"
      onClick={onSelect}
      title={titleParts.join(" · ")}
      aria-label={titleParts.join(", ")}
      aria-pressed={isSelected}
      className={`relative aspect-[4/3] overflow-hidden rounded-lg border text-left transition-[border-color,box-shadow,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        isSelected ? "border-primary bg-primary/[0.06] ring-2 ring-primary/40" : "border-border bg-card hover:border-muted-foreground/40"
      } ${node.is_active === false ? "opacity-50" : ""}`}
    >
      {band && (
        <>
          <span className={`absolute inset-x-0 bottom-0 ${band.wash}`} style={{ height: `${band.ratio * 100}%` }} />
          {band.ratio > 0 && <span className={`absolute inset-x-0 h-[2px] ${band.line}`} style={{ bottom: `${band.ratio * 100}%` }} />}
        </>
      )}
      <span className="absolute left-1.5 top-1.5 max-w-[45%] truncate font-mono text-[10px] leading-none text-foreground">
        {shortLabel}
      </span>
      {capacity && (
        <span className="absolute right-1.5 top-1.5 text-right text-[11px] font-semibold leading-none tabular-nums text-foreground">
          {occupied}/{capacity}
        </span>
      )}
    </button>
  );
}
