export interface OccupancyBand {
  key: "empty" | "healthy" | "filling" | "full" | "overflow";
  ratio: number;
  label: string;
  ink: string;
  wash: string;
  line: string;
}

export function occupancyBandFromRatio(raw: number): OccupancyBand {
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

export function occupancyBand(available: number | null | undefined, capacity: number | null | undefined): OccupancyBand | null {
  if (!capacity || capacity <= 0) return null;
  return occupancyBandFromRatio(Math.max(0, available ?? 0) / capacity);
}
