import { useEffect, useMemo, useState } from 'react';
import { Plus, Warehouse, MapPin, Building2, X, Loader2 } from 'lucide-react';
import { createWarehouse, getWarehouses } from '../services/api';

const EMPTY_FORM = {
  name: '',
  code: '',
  address: '',
  type: '',
};

function WarehouseModal({ open, onClose, onSubmit, submitting }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormData(EMPTY_FORM);
      setError('');
    }
  }, [open]);

  const handleChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.name.trim() || !formData.code.trim()) {
      setError('Name va Code la bat buoc.');
      return;
    }

    setError('');
    await onSubmit({
      name: formData.name.trim(),
      code: formData.code.trim(),
      address: formData.address.trim(),
      type: formData.type.trim(),
    }).catch((err) => {
      setError(err.message || 'Khong the tao kho moi.');
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800">Them kho moi</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800"
            disabled={submitting}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
              <input
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Kho Trung Tam"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Code *</label>
              <input
                value={formData.code}
                onChange={(e) => handleChange('code', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="WH-HCM-01"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <input
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Dia chi kho"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <input
              value={formData.type}
              onChange={(e) => handleChange('type', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Tong kho / Chi nhanh / Offline"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
            >
              Huy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:bg-indigo-300 flex items-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              Tao kho
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function WarehouseBuilderPage() {
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadWarehouses = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await getWarehouses();
      setWarehouses(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Khong the tai danh sach kho.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  const totalZones = useMemo(
    () => warehouses.reduce((sum, item) => sum + (item?._count?.zones || 0), 0),
    [warehouses]
  );

  const handleCreateWarehouse = async (payload) => {
    setCreating(true);
    try {
      await createWarehouse(payload);
      setIsModalOpen(false);
      await loadWarehouses();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Warehouse Management</h1>
          <p className="text-sm text-slate-500 mt-1">Quan ly thong tin kho va theo doi tong so zone cua tung kho.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg shadow-sm"
        >
          <Plus size={16} />
          Them kho moi
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Tong kho</p>
          <p className="text-3xl font-bold text-indigo-600 mt-1">{warehouses.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Tong zone</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{totalZones}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Trang thai</p>
          <p className="text-sm font-semibold text-slate-700 mt-3">{loading ? 'Dang dong bo du lieu...' : 'San sang'}</p>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={loadWarehouses} className="text-sm font-medium text-red-700 hover:text-red-800">
            Thu lai
          </button>
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Warehouse</th>
                <th className="px-4 py-3 text-left font-semibold">Code</th>
                <th className="px-4 py-3 text-left font-semibold">Address</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Zones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Dang tai danh sach kho...
                    </div>
                  </td>
                </tr>
              ) : warehouses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    Chua co kho nao. Bam "Them kho moi" de tao ban ghi dau tien.
                  </td>
                </tr>
              ) : (
                warehouses.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 text-slate-700 font-semibold">
                        <Warehouse size={16} className="text-indigo-500" />
                        {item.name || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">
                      <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium">
                        <Building2 size={12} />
                        {item.code || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 max-w-[320px] truncate">
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} className="text-slate-400" />
                        {item.address || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600">{item.type || '-'}</td>
                    <td className="px-4 py-3.5 text-right font-bold text-indigo-600">{item?._count?.zones || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <WarehouseModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateWarehouse}
        submitting={creating}
      />
    </div>
  );
}
