import { useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight, MapPin, Package } from "lucide-react";

const warehouseData = [
  {
    id: "WH-01",
    name: "Warehouse Main",
    capacity: 8500,
    used: 6845,
    zones: [
      {
        name: "Zone A",
        capacity: 2500,
        used: 2100,
        aisles: [
          { name: "Aisle A1", capacity: 500, used: 450, shelves: [{ name: "Shelf A1-01", capacity: 100, used: 90 }, { name: "Shelf A1-02", capacity: 100, used: 90 }] },
          { name: "Aisle A2", capacity: 500, used: 480, shelves: [{ name: "Shelf A2-01", capacity: 100, used: 100 }, { name: "Shelf A2-02", capacity: 100, used: 80 }] },
        ],
      },
      {
        name: "Zone B",
        capacity: 2500,
        used: 2250,
        aisles: [
          { name: "Aisle B1", capacity: 500, used: 500, shelves: [{ name: "Shelf B1-01", capacity: 100, used: 100 }, { name: "Shelf B1-02", capacity: 100, used: 100 }] },
          { name: "Aisle B2", capacity: 500, used: 450, shelves: [{ name: "Shelf B2-01", capacity: 100, used: 80 }, { name: "Shelf B2-02", capacity: 100, used: 90 }] },
        ],
      },
      {
        name: "Zone C",
        capacity: 1500,
        used: 1395,
        aisles: [
          { name: "Aisle C1", capacity: 500, used: 480, shelves: [{ name: "Shelf C1-01", capacity: 100, used: 100 }, { name: "Shelf C1-02", capacity: 100, used: 80 }] },
        ],
      },
    ],
  },
  {
    id: "WH-02",
    name: "Warehouse North",
    capacity: 5000,
    used: 3200,
    zones: [
      { name: "Zone A", capacity: 2500, used: 1800, aisles: [{ name: "Aisle A1", capacity: 500, used: 400, shelves: [{ name: "Shelf A1-01", capacity: 100, used: 100 }] }] },
      { name: "Zone B", capacity: 2500, used: 1400, aisles: [{ name: "Aisle B1", capacity: 500, used: 350, shelves: [{ name: "Shelf B1-01", capacity: 100, used: 50 }] }] },
    ],
  },
  {
    id: "WH-03",
    name: "Warehouse South",
    capacity: 4000,
    used: 2450,
    zones: [
      { name: "Zone A", capacity: 2000, used: 1500, aisles: [{ name: "Aisle A1", capacity: 500, used: 450, shelves: [{ name: "Shelf A1-01", capacity: 100, used: 90 }] }] },
      { name: "Zone B", capacity: 2000, used: 950, aisles: [{ name: "Aisle B1", capacity: 500, used: 300, shelves: [{ name: "Shelf B1-01", capacity: 100, used: 80 }] }] },
    ],
  },
];

function TreeNode({ node, type = "zone" }) {
  const [expanded, setExpanded] = useState(type === "warehouse");
  const capacityPct = (node.used / node.capacity) * 100;
  const getColor = () => capacityPct > 80 ? "bg-red-500" : capacityPct > 60 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 py-2 px-3 rounded-[8px] hover:bg-slate-100/60 transition-colors text-left group">
        <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </motion.div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[12px] truncate" style={{ fontWeight: 550 }}>{node.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${capacityPct}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
              className={`h-full rounded-full ${getColor()}`} />
          </div>
          <span className="text-[10px] text-slate-400 w-10 text-right" style={{ fontWeight: 550 }}>
            {Math.round(capacityPct)}%
          </span>
        </div>
      </button>

      {expanded && node.aisles && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ml-3 border-l border-slate-200 pl-3 space-y-0">
          {node.aisles.map(aisle => (
            <TreeNode key={aisle.name} node={aisle} type="aisle" />
          ))}
        </motion.div>
      )}

      {expanded && node.shelves && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ml-3 border-l border-slate-200 pl-3 space-y-0">
          {node.shelves.map(shelf => (
            <TreeNode key={shelf.name} node={shelf} type="shelf" />
          ))}
        </motion.div>
      )}
    </div>
  );
}

export function WarehousesPage() {
  const [selectedWh, setSelectedWh] = useState(warehouseData[0].id);
  const selected = warehouseData.find(w => w.id === selectedWh);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-violet-100 to-purple-50 flex items-center justify-center border border-violet-200/40">
            <Package className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">Warehouses</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">{warehouseData.length} locations · Hierarchical storage structure</p>
          </div>
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Warehouse Cards */}
        <div className="lg:col-span-1 space-y-3">
          {warehouseData.map(wh => {
            const capacityPct = (wh.used / wh.capacity) * 100;
            return (
              <FadeItem key={wh.id}>
                <motion.button onClick={() => setSelectedWh(wh.id)} whileHover={{ y: -2 }}
                  className={`w-full text-left p-4 rounded-[12px] border-2 transition-all ${selectedWh === wh.id ? "border-violet-500 bg-gradient-to-br from-violet-50/60 to-purple-50/40" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-[12px]" style={{ fontWeight: 650 }}>{wh.id}</h3>
                    {selectedWh === wh.id && <ChevronRight className="w-4 h-4 text-violet-600" />}
                  </div>
                  <p className="text-[11px] text-slate-500 mb-2">{wh.name}</p>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${capacityPct}%` }} transition={{ duration: 0.8 }}
                      className={`h-full rounded-full ${capacityPct > 80 ? "bg-red-500" : capacityPct > 60 ? "bg-amber-500" : "bg-emerald-500"}`} />
                  </div>
                  <p className="text-[10px] text-slate-400">
                    <span style={{ fontWeight: 550 }}>{wh.used}</span>{" "}
                    <span className="text-slate-300">/</span> {wh.capacity} units
                  </p>
                </motion.button>
              </FadeItem>
            );
          })}
        </div>

        {/* Location Tree */}
        <div className="lg:col-span-3">
          <FadeItem>
            <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>
                {selected?.name} - Location Structure
              </h3>
              <div className="space-y-0">
                {selected?.zones.map(zone => (
                  <TreeNode key={zone.name} node={zone} type="zone" />
                ))}
              </div>
            </div>
          </FadeItem>

          {/* Summary */}
          <FadeItem>
            <div className="bg-gradient-to-br from-violet-50/80 to-purple-50/50 rounded-[12px] border border-violet-100/60 p-4 mt-4">
              <h4 className="text-[12px]" style={{ fontWeight: 650 }}>Capacity Overview</h4>
              <div className="grid grid-cols-2 gap-3 mt-3">
                {[
                  { label: "Total Capacity", value: selected?.capacity || 0 },
                  { label: "Used", value: selected?.used || 0 },
                  { label: "Available", value: (selected?.capacity || 0) - (selected?.used || 0) },
                  { label: "Utilization", value: `${Math.round(((selected?.used || 0) / (selected?.capacity || 1)) * 100)}%` },
                ].map(s => (
                  <div key={s.label}>
                    <p className="text-[10px] text-slate-500 mb-0.5">{s.label}</p>
                    <p className="text-[14px] text-violet-700" style={{ fontWeight: 650 }}>{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </FadeItem>
        </div>
      </div>
    </PageWrapper>
  );
}
