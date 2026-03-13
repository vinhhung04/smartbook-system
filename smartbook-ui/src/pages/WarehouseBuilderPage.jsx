// src/pages/WarehouseBuilderPage.jsx
// Sơ đồ không gian kho — click kệ để xem chi tiết

import { useState } from 'react';
import { X, Package } from 'lucide-react';

// =====================  MOCK DATA  =====================
// capacity: sức chứa tối đa, used: đã dùng, books: danh sách sách đang ở đây
const ZONES = [
  {
    id: 'A1', label: 'Kệ A-1', capacity: 100, used: 95,
    books: [
      { title: 'Đắc Nhân Tâm',        qty: 35 },
      { title: 'Nhà Giả Kim',          qty: 28 },
      { title: 'Atomic Habits',         qty: 32 },
    ],
  },
  {
    id: 'A2', label: 'Kệ A-2', capacity: 100, used: 60,
    books: [
      { title: 'Sapiens',              qty: 22 },
      { title: 'Tư Duy Nhanh Và Chậm', qty: 38 },
    ],
  },
  {
    id: 'A3', label: 'Kệ A-3', capacity: 80, used: 20,
    books: [{ title: 'The Hobbit', qty: 20 }],
  },
  {
    id: 'A4', label: 'Kệ A-4', capacity: 80, used: 0,
    books: [],
  },
  {
    id: 'B1', label: 'Kệ B-1', capacity: 120, used: 118,
    books: [
      { title: 'Dune',                qty: 34 },
      { title: 'Foundation',          qty: 50 },
      { title: '1984',                qty: 34 },
    ],
  },
  {
    id: 'B2', label: 'Kệ B-2', capacity: 120, used: 110,
    books: [
      { title: 'Brave New World',     qty: 55 },
      { title: 'Fahrenheit 451',      qty: 55 },
    ],
  },
  {
    id: 'B3', label: 'Kệ B-3', capacity: 100, used: 45,
    books: [{ title: 'Nghệ Thuật Tư Duy', qty: 45 }],
  },
  {
    id: 'B4', label: 'Kệ B-4', capacity: 100, used: 70,
    books: [
      { title: 'Người Giàu Nhất Babylon', qty: 40 },
      { title: 'Nghĩ Và Làm Giàu',        qty: 30 },
    ],
  },
  {
    id: 'C1', label: 'Kệ C-1', capacity: 60, used: 5,
    books: [{ title: 'Manga One Piece T.1', qty: 5 }],
  },
  {
    id: 'C2', label: 'Kệ C-2', capacity: 60, used: 30,
    books: [{ title: 'Conan T.1', qty: 30 }],
  },
  {
    id: 'C3', label: 'Kệ C-3', capacity: 60, used: 58,
    books: [
      { title: 'Doraemon T.1', qty: 30 },
      { title: 'Dragon Ball T.1', qty: 28 },
    ],
  },
  {
    id: 'C4', label: 'Kệ C-4', capacity: 60, used: 0,
    books: [],
  },
];

// =====================  HELPER: màu sức chứa  =====================
function getZoneColor(used, capacity) {
  const ratio = capacity > 0 ? used / capacity : 0;
  if (ratio >= 0.9) return { bg: 'bg-red-500',    text: 'text-white', bar: 'bg-red-200',    fill: 'bg-red-600',   label: 'Gần đầy' };
  if (ratio >= 0.6) return { bg: 'bg-orange-400', text: 'text-white', bar: 'bg-orange-200', fill: 'bg-orange-500',label: 'Đang dùng' };
  if (ratio >= 0.1) return { bg: 'bg-green-400',  text: 'text-white', bar: 'bg-green-200',  fill: 'bg-green-500', label: 'Còn trống' };
  return                   { bg: 'bg-slate-200',  text: 'text-slate-600', bar: 'bg-slate-100', fill: 'bg-slate-400', label: 'Trống hoàn toàn' };
}

// =====================  MAIN PAGE  =====================
export default function WarehouseBuilderPage() {
  const [selectedZone, setSelectedZone] = useState(null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Sơ đồ Không gian Kho</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Nhấn vào một kệ để xem danh sách sách đang lưu trữ.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          { color: 'bg-red-500',    label: 'Gần đầy (≥ 90%)' },
          { color: 'bg-orange-400', label: 'Đang dùng (60–89%)' },
          { color: 'bg-green-400',  label: 'Còn trống (10–59%)' },
          { color: 'bg-slate-200',  label: 'Trống hoàn toàn' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${color}`} />
            <span className="text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Map + Detail panel */}
      <div className="flex gap-4 items-start">
        {/* ---- BẢN ĐỒ (70%) ---- */}
        <div className={`bg-white rounded-lg shadow-sm border border-gray-100 p-6 transition-all ${selectedZone ? 'w-[65%]' : 'w-full'}`}>
          {/* Grid sơ đồ */}
          <div className="grid grid-cols-4 gap-3">
            {ZONES.map((zone) => {
              const color  = getZoneColor(zone.used, zone.capacity);
              const ratio  = zone.capacity > 0 ? zone.used / zone.capacity : 0;
              const isSelected = selectedZone?.id === zone.id;
              return (
                <button
                  key={zone.id}
                  onClick={() => setSelectedZone(isSelected ? null : zone)}
                  className={`${color.bg} ${color.text} rounded-xl p-3 text-left transition-all hover:opacity-90 active:scale-95 shadow-sm
                    ${isSelected ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}
                >
                  <p className="font-bold text-sm">{zone.label}</p>
                  <p className="text-[11px] opacity-80 mt-0.5">{color.label}</p>
                  {/* Mini progress bar */}
                  <div className={`mt-2 h-1.5 rounded-full ${color.bar} overflow-hidden`}>
                    <div
                      className={`h-full rounded-full ${color.fill}`}
                      style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] opacity-70 mt-1">{zone.used}/{zone.capacity}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- BẢNG CHI TIẾT (30%) ---- */}
        {selectedZone && (
          <div className="w-[35%] bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden flex-shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-indigo-600">
              <div>
                <p className="text-white font-bold text-sm">{selectedZone.label}</p>
                <p className="text-indigo-200 text-xs mt-0.5">
                  {selectedZone.used}/{selectedZone.capacity} — {Math.round((selectedZone.used / selectedZone.capacity) * 100)}% đầy
                </p>
              </div>
              <button
                onClick={() => setSelectedZone(null)}
                className="text-white/70 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Danh sách sách */}
            <div className="divide-y divide-gray-100">
              {selectedZone.books.length === 0 ? (
                <div className="py-10 flex flex-col items-center text-gray-300">
                  <Package size={32} />
                  <p className="text-sm mt-2">Kệ đang trống</p>
                </div>
              ) : (
                selectedZone.books.map((book, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                    <p className="text-sm text-gray-700 font-medium truncate max-w-[75%]">{book.title}</p>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {book.qty}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-slate-50 border-t border-gray-100">
              <button className="w-full text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                Xem chi tiết kệ →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
