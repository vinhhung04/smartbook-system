// src/components/WarehouseHeatmap.jsx
// Sơ đồ nhiệt kho sách — nhìn từ trên xuống, tô màu theo tần suất lấy sách

// =====================  MOCK DATA  =====================
const shelves = [
  { id: 'A-1', label: 'Kệ A-1', picks: 320 },
  { id: 'A-2', label: 'Kệ A-2', picks: 210 },
  { id: 'A-3', label: 'Kệ A-3', picks: 180 },
  { id: 'A-4', label: 'Kệ A-4', picks: 95  },
  { id: 'B-1', label: 'Kệ B-1', picks: 290 },
  { id: 'B-2', label: 'Kệ B-2', picks: 340 },
  { id: 'B-3', label: 'Kệ B-3', picks: 55  },
  { id: 'B-4', label: 'Kệ B-4', picks: 130 },
  { id: 'C-1', label: 'Kệ C-1', picks: 20  },
  { id: 'C-2', label: 'Kệ C-2', picks: 75  },
  { id: 'C-3', label: 'Kệ C-3', picks: 260 },
  { id: 'C-4', label: 'Kệ C-4', picks: 310 },
  { id: 'D-1', label: 'Kệ D-1', picks: 45  },
  { id: 'D-2', label: 'Kệ D-2', picks: 160 },
  { id: 'D-3', label: 'Kệ D-3', picks: 190 },
  { id: 'D-4', label: 'Kệ D-4', picks: 10  },
];

// =====================  HELPER: Tính màu theo số lượt lấy  =====================
function getHeatColor(picks) {
  if (picks >= 280)      return { bg: 'bg-red-500',    text: 'text-white',      label: 'Rất nhiều' };
  if (picks >= 180)      return { bg: 'bg-orange-400', text: 'text-white',      label: 'Nhiều' };
  if (picks >= 100)      return { bg: 'bg-yellow-300', text: 'text-yellow-900', label: 'Vừa phải' };
  if (picks >= 40)       return { bg: 'bg-green-300',  text: 'text-green-900',  label: 'Ít' };
  return                        { bg: 'bg-blue-200',   text: 'text-blue-900',   label: 'Rất ít' };
}

const LEGEND = [
  { color: 'bg-red-500',    label: '≥ 280 lượt' },
  { color: 'bg-orange-400', label: '180–279' },
  { color: 'bg-yellow-300', label: '100–179' },
  { color: 'bg-green-300',  label: '40–99' },
  { color: 'bg-blue-200',   label: '< 40 lượt' },
];

// =====================  COMPONENT  =====================
export default function WarehouseHeatmap() {
  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        Sơ đồ nhiệt kho — tần suất lấy sách
      </h3>

      {/* Grid kệ sách */}
      <div className="grid grid-cols-4 gap-2 flex-1">
        {shelves.map((shelf) => {
          const { bg, text } = getHeatColor(shelf.picks);
          return (
            <div
              key={shelf.id}
              title={`${shelf.label}: ${shelf.picks} lượt`}
              className={`${bg} ${text} rounded-md flex flex-col items-center justify-center p-2 cursor-default transition-opacity hover:opacity-80`}
            >
              <span className="text-[11px] font-bold leading-tight">{shelf.label}</span>
              <span className="text-[10px] opacity-80 mt-0.5">{shelf.picks} lượt</span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {LEGEND.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm flex-shrink-0 ${color}`} />
            <span className="text-[11px] text-gray-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
