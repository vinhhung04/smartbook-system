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
  /** text color for icons/labels on soft chip backgrounds */
  ink: string;
  /** soft gradient background for small icon tiles (header, data plate, tag cards) */
  chip: string;
  /** gradient color stops (e.g. "from-indigo-500 to-blue-500") for large icon tiles / top accent bars — direction utility added at the call site */
  swatch: string;
  /** solid flat color for small tree indicator dots */
  dot: string;
  /** border/ring color for selected states */
  border: string;
}

export const WAREHOUSE_TYPE_META: Record<string, TypeMeta> = {
  WAREHOUSE: {
    icon: WarehouseIcon,
    label: "Kho tổng",
    ink: "text-indigo-600 dark:text-indigo-400",
    chip: "bg-gradient-to-br from-indigo-100 to-blue-50 dark:from-indigo-500/20 dark:to-blue-500/10",
    swatch: "from-indigo-500 to-blue-500",
    dot: "bg-indigo-500",
    border: "border-indigo-300 dark:border-indigo-500/40",
  },
  STORE: {
    icon: Store,
    label: "Cửa hàng",
    ink: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-500/20 dark:to-teal-500/10",
    swatch: "from-emerald-500 to-teal-500",
    dot: "bg-emerald-500",
    border: "border-emerald-300 dark:border-emerald-500/40",
  },
  BRANCH: {
    icon: Building2,
    label: "Chi nhánh",
    ink: "text-amber-600 dark:text-amber-400",
    chip: "bg-gradient-to-br from-amber-100 to-orange-50 dark:from-amber-500/20 dark:to-orange-500/10",
    swatch: "from-amber-500 to-orange-500",
    dot: "bg-amber-500",
    border: "border-amber-300 dark:border-amber-500/40",
  },
  LIBRARY: {
    icon: Library,
    label: "Thư viện",
    ink: "text-violet-600 dark:text-violet-400",
    chip: "bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-500/20 dark:to-purple-500/10",
    swatch: "from-violet-500 to-purple-500",
    dot: "bg-violet-500",
    border: "border-violet-300 dark:border-violet-500/40",
  },
};

export function warehouseTypeMeta(type: string | null | undefined): TypeMeta {
  return WAREHOUSE_TYPE_META[String(type || "").toUpperCase()] || WAREHOUSE_TYPE_META.WAREHOUSE;
}

export const LOCATION_TYPE_META: Record<string, TypeMeta> = {
  ZONE: {
    icon: LayoutGrid,
    label: "Khu vực",
    ink: "text-violet-600 dark:text-violet-400",
    chip: "bg-violet-100 dark:bg-violet-500/15",
    swatch: "from-violet-500 to-purple-500",
    dot: "bg-violet-500",
    border: "border-violet-300 dark:border-violet-500/40",
  },
  SHELF: {
    icon: BookOpen,
    label: "Kệ",
    ink: "text-cyan-600 dark:text-cyan-400",
    chip: "bg-cyan-100 dark:bg-cyan-500/15",
    swatch: "from-cyan-500 to-blue-500",
    dot: "bg-cyan-500",
    border: "border-cyan-300 dark:border-cyan-500/40",
  },
  SHELF_COMPARTMENT: {
    icon: Package,
    label: "Ngăn kệ",
    ink: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-100 dark:bg-emerald-500/15",
    swatch: "from-emerald-500 to-teal-500",
    dot: "bg-emerald-500",
    border: "border-emerald-300 dark:border-emerald-500/40",
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
