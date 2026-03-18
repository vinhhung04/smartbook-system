import { useMemo, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

const TABS = [
  { key: 'borrowing', label: 'Đang mượn' },
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'returned', label: 'Đã trả' },
];

const STATUS_CONFIG = {
  borrowing: { label: 'Đang mượn', className: 'bg-yellow-100 text-yellow-700' },
  overdue: { label: 'Quá hạn', className: 'bg-red-100 text-red-600' },
  returned: { label: 'Đã trả', className: 'bg-green-100 text-green-700' },
};

const MOCK_BORROW_RECORDS = [
  {
    id: 'PM-2026-001',
    readerName: 'Nguyễn Minh Anh',
    bookTitle: 'Đắc Nhân Tâm',
    borrowedAt: '02/03/2026',
    dueAt: '16/03/2026',
    status: 'borrowing',
    fineAmount: 0,
  },
  {
    id: 'PM-2026-002',
    readerName: 'Trần Khánh Ly',
    bookTitle: 'Sapiens: Lược Sử Loài Người',
    borrowedAt: '25/02/2026',
    dueAt: '10/03/2026',
    status: 'overdue',
    fineAmount: 35000,
  },
  {
    id: 'PM-2026-003',
    readerName: 'Lê Hoàng Nam',
    bookTitle: 'Atomic Habits',
    borrowedAt: '05/03/2026',
    dueAt: '19/03/2026',
    status: 'borrowing',
    fineAmount: 0,
  },
  {
    id: 'PM-2026-004',
    readerName: 'Phạm Thu Trang',
    bookTitle: 'Nhà Giả Kim',
    borrowedAt: '18/02/2026',
    dueAt: '04/03/2026',
    status: 'returned',
    fineAmount: 0,
    returnedAt: '03/03/2026',
  },
  {
    id: 'PM-2026-005',
    readerName: 'Đỗ Quốc Bảo',
    bookTitle: 'Tư Duy Nhanh Và Chậm',
    borrowedAt: '20/02/2026',
    dueAt: '06/03/2026',
    status: 'overdue',
    fineAmount: 50000,
  },
  {
    id: 'PM-2026-006',
    readerName: 'Võ Ngọc Hân',
    bookTitle: 'Tuổi Trẻ Đáng Giá Bao Nhiêu',
    borrowedAt: '01/03/2026',
    dueAt: '15/03/2026',
    status: 'returned',
    fineAmount: 15000,
    returnedAt: '15/03/2026',
  },
];

function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function ReturnConfirmModal({ open, record, onClose, onConfirm }) {
  const [hasFine, setHasFine] = useState(false);
  const [fineAmount, setFineAmount] = useState('');
  const [note, setNote] = useState('');

  if (!open || !record) return null;

  const handleClose = () => {
    setHasFine(false);
    setFineAmount('');
    setNote('');
    onClose();
  };

  const handleConfirm = (event) => {
    event.preventDefault();

    onConfirm(record.id, {
      hasFine,
      fineAmount: hasFine ? Number(fineAmount || 0) : 0,
      note: note.trim(),
    });

    setHasFine(false);
    setFineAmount('');
    setNote('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Ghi nhận trả sách</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Xác nhận độc giả đã hoàn trả sách và cập nhật phí phạt nếu có.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleConfirm} className="p-5 space-y-4">
          <div className="bg-slate-50 border border-gray-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-500">Mã phiếu</span>
              <span className="text-sm font-semibold text-indigo-600 font-mono">{record.id}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-500">Độc giả</span>
              <span className="text-sm font-medium text-gray-800 text-right">{record.readerName}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-500">Tên sách</span>
              <span className="text-sm font-medium text-gray-800 text-right">{record.bookTitle}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-500">Hạn trả</span>
              <span className="text-sm font-medium text-gray-800">{record.dueAt}</span>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hasFine}
              onChange={(event) => {
                setHasFine(event.target.checked);
                if (!event.target.checked) {
                  setFineAmount('');
                }
              }}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">Có phí phạt</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Áp dụng khi độc giả trả trễ hạn hoặc làm hư hỏng sách.
              </p>
            </div>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Số tiền phạt</label>
            <input
              type="number"
              min="0"
              value={fineAmount}
              disabled={!hasFine}
              onChange={(event) => setFineAmount(event.target.value)}
              placeholder="Nhập số tiền phạt"
              className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ghi chú</label>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Nhập ghi chú nếu cần"
              className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
            >
              Xác nhận trả sách
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BorrowManagementPage() {
  const [activeTab, setActiveTab] = useState('borrowing');
  const [records, setRecords] = useState(MOCK_BORROW_RECORDS);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const filteredRecords = useMemo(
    () => records.filter((record) => record.status === activeTab),
    [records, activeTab]
  );

  const summaryItems = useMemo(
    () => [
      { label: 'Đang mượn', value: records.filter((record) => record.status === 'borrowing').length, color: 'text-yellow-600' },
      { label: 'Quá hạn', value: records.filter((record) => record.status === 'overdue').length, color: 'text-red-600' },
      { label: 'Đã trả', value: records.filter((record) => record.status === 'returned').length, color: 'text-green-600' },
    ],
    [records]
  );

  const handleConfirmReturn = (id, payload) => {
    setRecords((prev) => prev.map((record) => (
      record.id === id
        ? {
            ...record,
            status: 'returned',
            fineAmount: payload.fineAmount,
            returnNote: payload.note,
            returnedAt: '16/03/2026',
          }
        : record
    )));
    setSelectedRecord(null);
    setActiveTab('returned');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản lý mượn trả sách</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Theo dõi toàn bộ phiếu mượn, trả và tình trạng quá hạn của độc giả
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {summaryItems.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 text-center">
            <p className="text-xs text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-1 inline-flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left border-b border-gray-200">
                <th className="px-5 py-3 font-semibold">Mã phiếu</th>
                <th className="px-5 py-3 font-semibold">Tên độc giả</th>
                <th className="px-5 py-3 font-semibold">Tên sách</th>
                <th className="px-5 py-3 font-semibold">Ngày mượn</th>
                <th className="px-5 py-3 font-semibold">Hạn trả</th>
                <th className="px-5 py-3 font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400 text-sm">
                    Không có phiếu nào trong mục này.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => {
                  const status = STATUS_CONFIG[record.status] ?? STATUS_CONFIG.borrowing;

                  return (
                    <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs font-semibold text-indigo-600">
                        {record.id}
                      </td>
                      <td className="px-5 py-3.5 text-gray-700 font-medium">{record.readerName}</td>
                      <td className="px-5 py-3.5 text-gray-600">{record.bookTitle}</td>
                      <td className="px-5 py-3.5 text-gray-500 text-sm">{record.borrowedAt}</td>
                      <td className="px-5 py-3.5 text-gray-500 text-sm">{record.dueAt}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {record.status === 'returned' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
                            <CheckCircle2 size={14} />
                            Đã hoàn tất
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="text-xs text-indigo-600 hover:underline font-medium"
                          >
                            Ghi nhận trả sách
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReturnConfirmModal
        open={Boolean(selectedRecord)}
        record={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        onConfirm={handleConfirmReturn}
      />
    </div>
  );
}