import { ChevronRight } from "lucide-react";
import type { LocationNode } from "@/services/warehouse";
import { locationTypeMeta } from "./meta";

interface LocationTreeProps {
  nodes: LocationNode[];
  selectedId: string;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (node: LocationNode) => void;
}

export function LocationTree({ nodes, selectedId, expandedIds, onToggleExpand, onSelect }: LocationTreeProps) {
  if (nodes.length === 0) return null;

  return (
    <ul className="space-y-0.5" role="tree">
      {nodes.map((node) => (
        <LocationTreeRow
          key={node.id}
          node={node}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function LocationTreeRow({
  node,
  selectedId,
  expandedIds,
  onToggleExpand,
  onSelect,
}: {
  node: LocationNode;
  selectedId: string;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (node: LocationNode) => void;
}) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const isInactive = node.is_active === false;
  const meta = locationTypeMeta(node.location_type);

  return (
    <li role="treeitem" aria-selected={isSelected} aria-expanded={hasChildren ? isExpanded : undefined}>
      <div
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node);
          }
        }}
        tabIndex={0}
        className={`group relative flex items-center gap-1.5 rounded-md py-1.5 pl-1 pr-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
          isSelected ? "bg-primary/10" : "hover:bg-accent"
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? `Thu gọn ${node.name || node.code}` : `Mở rộng ${node.name || node.code}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="shrink-0 w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="shrink-0 w-4 h-4" />
        )}

        <span className={`shrink-0 w-2 h-2 rounded-[2px] ${meta.dot}`} />

        <span
          className={`truncate text-[12.5px] font-medium ${isInactive ? "text-muted-foreground/70 line-through decoration-1" : "text-foreground/90"}`}
        >
          {node.name || node.code}
        </span>

        <span className="shrink-0 ml-auto pl-2 font-mono text-[10px] text-muted-foreground/70">{node.code}</span>
      </div>

      {hasChildren && isExpanded && (
        <ul className="ml-[11px] pl-3 border-l border-dashed border-border" role="group">
          {node.children!.map((child) => (
            <LocationTreeRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
