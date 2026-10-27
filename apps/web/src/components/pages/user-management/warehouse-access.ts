import type { WarehouseAccessLevel, WarehouseScope } from "@/services/user";

/** The existing auth-service levels; READ / READ_ONLY only read, the rest can also act. */
export const ACCESS_LEVEL_OPTIONS: Array<{ value: WarehouseAccessLevel; label: string; hint: string }> = [
  { value: "READ", label: "Chỉ xem", hint: "Xem dữ liệu kho, không nhận hay thao tác việc" },
  { value: "READ_ONLY", label: "Chỉ xem (READ_ONLY)", hint: "Giống Chỉ xem, giữ cho dữ liệu cũ" },
  { value: "WRITE", label: "Ghi", hint: "Xem và thao tác nghiệp vụ kho" },
  { value: "OPERATOR", label: "Vận hành", hint: "Nhận và thực hiện việc kho" },
  { value: "FULL", label: "Toàn quyền", hint: "Toàn quyền nghiệp vụ trong kho" },
];

export const ACCESS_LEVEL_LABELS: Record<string, string> = Object.fromEntries(
  ACCESS_LEVEL_OPTIONS.map((option) => [option.value, option.label]),
);

/** A row being edited; warehouse_id is "" until a warehouse is picked. */
export type ScopeDraft = { warehouse_id: string; access_level: WarehouseAccessLevel };

export function toScopes(rows: ScopeDraft[]): WarehouseScope[] {
  return rows.filter((row) => row.warehouse_id).map((row) => ({ warehouse_id: row.warehouse_id, access_level: row.access_level }));
}

const WRITE_LEVELS = new Set<string>(["WRITE", "OPERATOR", "FULL"]);

export function canActWith(level: string | undefined | null) {
  return WRITE_LEVELS.has(String(level || "").toUpperCase());
}

export interface ScopeDiff {
  added: WarehouseScope[];
  removed: WarehouseScope[];
  changed: Array<{ warehouse_id: string; from: string; to: string }>;
}

export function diffScopes(before: WarehouseScope[], after: WarehouseScope[]): ScopeDiff {
  const beforeById = new Map(before.map((row) => [row.warehouse_id, row.access_level]));
  const afterById = new Map(after.map((row) => [row.warehouse_id, row.access_level]));
  return {
    added: after.filter((row) => !beforeById.has(row.warehouse_id)),
    removed: before.filter((row) => !afterById.has(row.warehouse_id)),
    changed: after
      .filter((row) => beforeById.has(row.warehouse_id) && beforeById.get(row.warehouse_id) !== row.access_level)
      .map((row) => ({ warehouse_id: row.warehouse_id, from: beforeById.get(row.warehouse_id) as string, to: row.access_level })),
  };
}

export function hasScopeChanges(diff: ScopeDiff) {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
