import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Barcode, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import {
  createGoodsReceipt,
  createIncompleteBook,
  findBookByBarcode,
  getWarehouseLocations,
  getWarehouses,
} from '../services/api';

function formatMoney(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '0';
  return new Intl.NumberFormat('vi-VN').format(numberValue);
}

function makeRow(data, defaultLocationId) {
  return {
    row_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    variant_id: data.variant_id,
    barcode: data.barcode,
    title: data.title,
    unit_cost: Number(data.unit_cost || 0),
    quantity: 1,
    location_id: defaultLocationId || '',
    is_new_book: Boolean(data.is_incomplete || data.created_new),
  };
}

function NewBookModal({ open, barcode, submitting, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setPrice('');
    setError('');
  }, [open]);

  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    const value = Number(price);

    if (!title.trim()) {
      setError('Vui lòng nhập tên sách.');
      return;
    }

    if (!Number.isFinite(value) || value < 0) {
      setError('Giá sách phải lớn hơn hoặc bằng 0.');
      return;
    }

    setError('');
    onSave({ title: title.trim(), price: value });
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="glass-card w-full max-w-lg rounded-2xl p-6">
        <h3 className="text-lg font-bold text-slate-800">Sách mới chưa có trong hệ thống</h3>
        <p className="text-sm text-slate-600 mt-1">
          Barcode: <span className="font-semibold text-slate-800">{barcode}</span>
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tên sách</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Nhập tên sách mới"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Giá</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Nhập giá sách"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-400"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
              {submitting ? 'Đang tạo sách...' : 'Lưu sách mới'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AIImportPage() {
  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [processingBarcode, setProcessingBarcode] = useState(false);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [creatingBook, setCreatingBook] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [pendingRows, setPendingRows] = useState([]);

  const [newBookModal, setNewBookModal] = useState({
    open: false,
    barcode: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function loadWarehouses() {
      try {
        const data = await getWarehouses();
        if (cancelled) return;

        const rows = Array.isArray(data) ? data : [];
        setWarehouses(rows);

        if (rows.length > 0) {
          setWarehouseId(rows[0].id);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error.message || 'Không tải được danh sách kho.');
        }
      } finally {
        if (!cancelled) {
          setLoadingWarehouses(false);
        }
      }
    }

    loadWarehouses();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!warehouseId) {
      setLocations([]);
      return;
    }

    let cancelled = false;

    async function loadLocations() {
      setLoadingLocations(true);
      try {
        const response = await getWarehouseLocations(warehouseId);
        if (cancelled) return;
        const rows = Array.isArray(response?.locations) ? response.locations : [];
        setLocations(rows);

        setPendingRows((prev) => {
          const fallbackLocation = rows[0]?.id || '';
          return prev.map((row) => ({
            ...row,
            location_id: row.location_id || fallbackLocation,
          }));
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error.message || 'Không tải được vị trí kho.');
          setLocations([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingLocations(false);
        }
      }
    }

    loadLocations();

    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const totalQuantity = useMemo(
    () => pendingRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    [pendingRows]
  );

  function upsertPendingRow(bookData) {
    const defaultLocationId = locations[0]?.id || '';

    setPendingRows((prev) => {
      const existingIndex = prev.findIndex((row) => row.variant_id === bookData.variant_id);

      if (existingIndex >= 0) {
        const next = [...prev];
        const current = next[existingIndex];
        next[existingIndex] = {
          ...current,
          quantity: Number(current.quantity || 0) + 1,
        };
        return next;
      }

      return [...prev, makeRow(bookData, defaultLocationId)];
    });
  }

  async function handleBarcodeSubmit(event) {
    event.preventDefault();

    const barcode = barcodeInput.trim();
    if (!barcode || processingBarcode) {
      return;
    }

    if (!warehouseId) {
      setErrorMessage('Vui lòng chọn kho trước khi quét barcode.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setProcessingBarcode(true);

    try {
      const result = await findBookByBarcode(barcode);
      upsertPendingRow(result);
      setBarcodeInput('');
    } catch (error) {
      const msg = error.message || '';
      if (msg.toLowerCase().includes('not found')) {
        setNewBookModal({ open: true, barcode });
      } else {
        setErrorMessage(msg || 'Không thể tìm sách theo barcode.');
      }
    } finally {
      setProcessingBarcode(false);
    }
  }

  async function handleCreateNewBook(payload) {
    setCreatingBook(true);
    setErrorMessage('');

    try {
      const response = await createIncompleteBook({
        barcode: newBookModal.barcode,
        title: payload.title,
        price: payload.price,
      });

      const bookData = response?.data;
      upsertPendingRow(bookData);
      setNewBookModal({ open: false, barcode: '' });
      setBarcodeInput('');
      setSuccessMessage('Đã tạo sách INCOMPLETE và thêm vào danh sách chờ nhập.');
    } catch (error) {
      setErrorMessage(error.message || 'Không thể tạo sách mới.');
    } finally {
      setCreatingBook(false);
    }
  }

  function updateRow(rowId, key, value) {
    setPendingRows((prev) =>
      prev.map((row) => (row.row_id === rowId ? { ...row, [key]: value } : row))
    );
  }

  function removeRow(rowId) {
    setPendingRows((prev) => prev.filter((row) => row.row_id !== rowId));
  }

  async function handleConfirmReceipt() {
    if (!warehouseId) {
      setErrorMessage('Vui lòng chọn kho.');
      return;
    }

    if (pendingRows.length === 0) {
      setErrorMessage('Danh sách nhập đang trống. Hãy quét hoặc nhập barcode trước.');
      return;
    }

    const invalidRow = pendingRows.find((row) => {
      const quantity = Number(row.quantity);
      const unitCost = Number(row.unit_cost);
      return !row.variant_id || !row.location_id || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0;
    });

    if (invalidRow) {
      setErrorMessage('Mỗi dòng phải có location, số lượng > 0 và đơn giá hợp lệ.');
      return;
    }

    setSubmittingReceipt(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const payload = {
        warehouse_id: warehouseId,
        note: receiptNote || null,
        items: pendingRows.map((row) => ({
          variant_id: row.variant_id,
          location_id: row.location_id,
          quantity: Number(row.quantity),
          unit_cost: Number(row.unit_cost),
          is_new_book: row.is_new_book,
        })),
      };

      const response = await createGoodsReceipt(payload);
      setSuccessMessage(
        `Đã tạo phiếu nhập ${response?.data?.receipt_number || ''} ở trạng thái ${response?.data?.status || 'DRAFT'}.`
      );
      setPendingRows([]);
      setReceiptNote('');
    } catch (error) {
      setErrorMessage(error.message || 'Tạo phiếu nhập thất bại.');
    } finally {
      setSubmittingReceipt(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bento-card rounded-2xl p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-indigo-600 font-semibold">Inbound Workflow</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Nhập kho theo Barcode</h1>
          <p className="text-sm text-slate-600 mt-2">
            Quét hoặc nhập barcode, hệ thống tự tìm sách. Nếu chưa tồn tại, tạo nhanh sách INCOMPLETE để đưa vào phiếu nhập chờ duyệt.
          </p>

          <form onSubmit={handleBarcodeSubmit} className="mt-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Quét/Nhập Barcode</label>
            <div className="flex items-center gap-2 rounded-xl border border-indigo-300 bg-white px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500">
              <Barcode size={18} className="text-indigo-500" />
              <input
                value={barcodeInput}
                onChange={(event) => setBarcodeInput(event.target.value)}
                placeholder="Quét mã vạch hoặc nhập rồi nhấn Enter"
                className="w-full bg-transparent outline-none text-sm"
              />
              <button
                type="submit"
                disabled={processingBarcode || loadingWarehouses || loadingLocations}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-indigo-300"
              >
                {processingBarcode ? <Loader2 size={13} className="animate-spin" /> : null}
                {processingBarcode ? 'Đang tìm...' : 'Thêm'}
              </button>
            </div>
          </form>
        </div>

        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Thông tin phiếu nhập</h2>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Kho</label>
            <select
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              disabled={loadingWarehouses}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Chọn kho</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} ({warehouse.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea
              value={receiptNote}
              onChange={(event) => setReceiptNote(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Ghi chú thêm cho phiếu nhập"
            />
          </div>

          <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            Tổng số dòng: <span className="font-semibold">{pendingRows.length}</span>
            <br />
            Tổng số lượng: <span className="font-semibold">{totalQuantity}</span>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="bento-card rounded-2xl p-5">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-2 py-2">Barcode</th>
                <th className="px-2 py-2">Tên sách</th>
                <th className="px-2 py-2 w-44">Vị trí</th>
                <th className="px-2 py-2 w-32">Đơn giá</th>
                <th className="px-2 py-2 w-24">Số lượng</th>
                <th className="px-2 py-2 w-20">Xóa</th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.map((row) => (
                <tr key={row.row_id} className="border-b border-slate-100">
                  <td className="px-2 py-2 text-slate-700 font-medium">{row.barcode}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-slate-800">{row.title}</div>
                    {row.is_new_book ? (
                      <div className="text-[11px] text-amber-600 mt-0.5">Sách mới INCOMPLETE - cần Thủ thư bổ sung thông tin</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={row.location_id}
                      onChange={(event) => updateRow(row.row_id, 'location_id', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Chọn vị trí</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.location_code} ({location.location_type})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.unit_cost}
                      onChange={(event) => updateRow(row.row_id, 'unit_cost', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="text-[11px] text-slate-400 mt-1">{formatMoney(row.unit_cost)} VND</div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={row.quantity}
                      onChange={(event) => updateRow(row.row_id, 'quantity', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.row_id)}
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}

              {pendingRows.length === 0 ? (
                <tr>
                  <td className="px-2 py-6 text-center text-slate-500" colSpan={6}>
                    Chưa có dòng nào. Hãy quét barcode để bắt đầu.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={handleConfirmReceipt}
            disabled={submittingReceipt || loadingWarehouses || loadingLocations}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-emerald-300"
          >
            {submittingReceipt ? <Loader2 size={16} className="animate-spin" /> : null}
            {submittingReceipt ? 'Đang xử lý phiếu nhập...' : 'Xác nhận phiếu nhập'}
          </button>
        </div>
      </div>

      <NewBookModal
        open={newBookModal.open}
        barcode={newBookModal.barcode}
        submitting={creatingBook}
        onClose={() => setNewBookModal({ open: false, barcode: '' })}
        onSave={handleCreateNewBook}
      />
    </div>
  );
}
