import type { LucideIcon } from "lucide-react";
import {
  Warehouse as WarehouseIcon,
  Store,
  Building2,
  Library,
  LayoutGrid,
  BookOpen,
  Package,
} from "lucide-react";
import type { LocationNode } from "@/services/warehouse";

export interface TypeMeta {
  icon: LucideIcon;
  label: string;
}

export const WAREHOUSE_TYPE_META: Record<string, TypeMeta> = {
  WAREHOUSE: {
    icon: WarehouseIcon,
    label: "Kho tổng",
  },
  STORE: {
    icon: Store,
    label: "Cửa hàng",
  },
  BRANCH: {
    icon: Building2,
    label: "Chi nhánh",
  },
  LIBRARY: {
    icon: Library,
    label: "Thư viện",
  },
};

export function warehouseTypeMeta(type: string | null | undefined): TypeMeta {
  return WAREHOUSE_TYPE_META[String(type || "").toUpperCase()] || WAREHOUSE_TYPE_META.WAREHOUSE;
}

export const LOCATION_TYPE_META: Record<string, TypeMeta> = {
  ZONE: {
    icon: LayoutGrid,
    label: "Khu vực",
  },
  SHELF: {
    icon: BookOpen,
    label: "Kệ",
  },
  SHELF_COMPARTMENT: {
    icon: Package,
    label: "Ngăn kệ",
  },
};

export function locationTypeMeta(type: string | null | undefined): TypeMeta {
  return LOCATION_TYPE_META[String(type || "").toUpperCase()] || LOCATION_TYPE_META.SHELF_COMPARTMENT;
}

export const LOCATION_TYPES = ["ZONE", "SHELF", "SHELF_COMPARTMENT"];
export const ROOT_TYPES = ["ZONE"];
export const CHILD_TYPE_BY_PARENT: Record<string, string> = {
  ZONE: "SHELF",
  SHELF: "SHELF_COMPARTMENT",
};

export function normalizeType(value: string | null | undefined): string {
  return String(value || "").trim().toUpperCase();
}

export function flattenNodes(nodes: LocationNode[]): LocationNode[] {
  const output: LocationNode[] = [];
  const visit = (node: LocationNode) => {
    output.push(node);
    (node.children || []).forEach(visit);
  };
  nodes.forEach(visit);
  return output;
}

export function collectIds(nodes: LocationNode[]): string[] {
  return flattenNodes(nodes).map((node) => node.id);
}

/** Prunes the tree to nodes matching `term` by name/code plus their ancestors. */
export function filterLocationTree(nodes: LocationNode[], term: string): LocationNode[] {
  const q = term.trim().toLowerCase();
  if (!q) return nodes;

  const walk = (list: LocationNode[]): LocationNode[] => {
    const out: LocationNode[] = [];
    for (const node of list) {
      const children = node.children && node.children.length > 0 ? walk(node.children) : [];
      const selfMatch =
        (node.name || "").toLowerCase().includes(q) || (node.code || "").toLowerCase().includes(q);
      if (selfMatch || children.length > 0) {
        out.push({ ...node, children });
      }
    }
    return out;
  };

  return walk(nodes);
}

export function ancestorIds(nodeId: string, flat: LocationNode[]): string[] {
  const ids: string[] = [];
  let current = flat.find((item) => item.id === nodeId) || null;
  while (current?.parent_location_id) {
    ids.push(current.parent_location_id);
    current = flat.find((item) => item.id === current!.parent_location_id) || null;
  }
  return ids;
}

export type { OccupancyBand } from "@/lib/occupancy";
export { occupancyBand } from "@/lib/occupancy";

export interface WarehouseLocationSummary {
  zoneCount: number;
  shelfCount: number;
  compartmentCount: number;
  /** Sum of compartment capacity_qty; null when no compartment has a capacity set. */
  capacityTotal: number | null;
  /** Copies on hand in those same compartments (the ones with a capacity), from `occupied_qty`. */
  occupiedTotal: number;
}

/** Aggregates a location tree into per-type counts plus compartment capacity and fill, for a glanceable summary. */
export function summarizeLocationTree(tree: LocationNode[]): WarehouseLocationSummary {
  const flat = flattenNodes(tree);
  let zoneCount = 0;
  let shelfCount = 0;
  let compartmentCount = 0;
  let capacityTotal: number | null = null;
  let occupiedTotal = 0;

  flat.forEach((node) => {
    const type = normalizeType(node.location_type);
    if (type === "ZONE") zoneCount += 1;
    else if (type === "SHELF") shelfCount += 1;
    else if (type === "SHELF_COMPARTMENT") {
      compartmentCount += 1;
      if (typeof node.capacity_qty === "number" && node.capacity_qty > 0) {
        capacityTotal = (capacityTotal ?? 0) + node.capacity_qty;
        occupiedTotal += node.occupied_qty ?? 0;
      }
    }
  });

  return { zoneCount, shelfCount, compartmentCount, capacityTotal, occupiedTotal };
}

/** Capacity of a location: its own capacity_qty, else the sum of what is below it (null if none is set). */
export function capacityOf(node: LocationNode): number | null {
  if (typeof node.capacity_qty === "number" && node.capacity_qty > 0) return node.capacity_qty;
  const below = (node.children || []).map(capacityOf).filter((value): value is number => value !== null);
  return below.length > 0 ? below.reduce((sum, value) => sum + value, 0) : null;
}
