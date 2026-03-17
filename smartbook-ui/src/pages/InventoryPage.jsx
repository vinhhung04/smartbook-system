import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pencil, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { createIncompleteBook, generateBookSummary, getAllBooks, updateBookDetails } from '../services/api';

const STATUS_CONFIG = {
  in_stock: { label: 'Còn hàng', className: 'bg-green-100 text-green-700' },
  low_stock: { label: 'Sắp hết', className: 'bg-orange-100 text-orange-600' },
  out_of_stock: { label: 'Hết hàng', className: 'bg-red-100 text-red-600' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.in_stock;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function getStockStatus(quantity) {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= 10) return 'low_stock';
  return 'in_stock';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}

function CoverImage({ src, alt }) {
  if (!src) {
    return (
      <div className="h-14 w-10 rounded border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-400 flex items-center justify-center">
        No image
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || 'Bìa sách'}
      className="h-14 w-10 rounded object-cover border border-slate-200"
      loading="lazy"
    />
  );
}

function WarehouseLocationsCell({ book }) {
  const locations = Array.isArray(book.locations) ? book.locations : [];

  if (locations.length === 0) {
    return <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-1 rounded">-</span>;
  }

  const visibleLocations = locations.slice(0, 2);
  const remainingCount = locations.length - visibleLocations.length;
  const allLocationsText = locations.map((entry) => `${entry.label} (${entry.quantity})`).join('\n');

  return (
    <div className="flex items-center gap-1.5 flex-wrap" title={allLocationsText}>
      {visibleLocations.map((entry) => (
        <span key={entry.label} className="bg-slate-100 text-slate-600 text-[11px] font-medium px-2 py-1 rounded whitespace-nowrap">
          {entry.label} ({entry.quantity})
        </span>
      ))}
      {remainingCount > 0 ? (
        <span className="bg-indigo-100 text-indigo-700 text-[11px] font-semibold px-2 py-1 rounded">+{remainingCount}</span>
      ) : null}
    </div>
  );
}

function EditBookModal({ open, book, submitting, onClose, onSave }) {
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    language: 'vi',
    publish_year: '',
    author_name: '',
    publisher_name: '',
    category_name: '',
    description: '',
    list_price: 0,
    unit_cost: 0,
    isbn13: '',
    isbn10: '',
    internal_barcode: '',
    cover_image_url: '',
  });
  const [uploadError, setUploadError] = useState('');
  const [formError, setFormError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    if (!open || !book) return;
    setAiError('');
    setAiLoading(false);
    setForm({
      title: book.title || '',
      subtitle: book.subtitle || '',
      language: book.language || 'vi',
      publish_year: book.publish_year || '',
      author_name: book.author || '',
      publisher_name: book.publisher || '',
      category_name: book.category || '',
      description: book.description || '',
      list_price: Number(book.list_price || 0),
      unit_cost: Number(book.unit_cost || 0),
      isbn13: '',
      isbn10: '',
      internal_barcode: book.isbn && book.isbn !== '-' ? book.isbn : '',
      cover_image_url: book.cover_image_url || '',
    });
    setUploadError('');
    setFormError('');
  }, [open, book]);

  if (!open || !book) {
    return null;
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAiGenerate() {
    const title = form.title.trim() || book.title || '';
    const author = form.author_name.trim();
    if (!title) {
      setAiError('Vui lòng nhập Tên sách trước khi tạo mô tả AI.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const result = await generateBookSummary(title, author);
      setField('description', result.description || '');
    } catch (err) {
      setAiError(err.message || 'AI service không phản hồi.');
    } finally {
      setAiLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (String(form.publish_year).trim()) {
      const publishYear = Number(form.publish_year);
      if (!Number.isInteger(publishYear) || publishYear < 1000 || publishYear > 2100) {
        setFormError('Năm xuất bản phải là số nguyên từ 1000 đến 2100.');
        return;
      }
    }

    setFormError('');
    onSave(form);
  }

  async function handleSelectCoverFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Chỉ hỗ trợ tệp ảnh.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Ảnh tối đa 2MB.');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setField('cover_image_url', dataUrl);
      setUploadError('');
    } catch (error) {
      setUploadError(error.message || 'Upload ảnh thất bại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white border border-slate-200 shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Cập nhật chi tiết sách</h2>
            <p className="text-xs text-slate-500 mt-0.5">ID: {book.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Đóng
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[78vh] overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tên sách</label>
              <input
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Phụ đề</label>
              <input
                value={form.subtitle}
                onChange={(e) => setField('subtitle', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tác giả</label>
              <input
                value={form.author_name}
                onChange={(e) => setField('author_name', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nhà xuất bản</label>
              <input
                value={form.publisher_name}
                onChange={(e) => setField('publisher_name', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Thể loại</label>
              <input
                value={form.category_name}
                onChange={(e) => setField('category_name', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Barcode nội bộ</label>
              <input
                value={form.internal_barcode}
                onChange={(e) => setField('internal_barcode', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">ISBN13</label>
              <input
                value={form.isbn13}
                onChange={(e) => setField('isbn13', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">ISBN10</label>
              <input
                value={form.isbn10}
                onChange={(e) => setField('isbn10', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ngôn ngữ sáng tác</label>
              <input
                value={form.language}
                onChange={(e) => setField('language', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="vi"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Năm xuất bản</label>
              <input
                type="number"
                min="1000"
                max="2100"
                value={form.publish_year}
                onChange={(e) => setField('publish_year', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="2024"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Giá bán</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.list_price}
                onChange={(e) => setField('list_price', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Giá nhập</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.unit_cost}
                onChange={(e) => setField('unit_cost', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-600">Mô tả</label>
              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={aiLoading || submitting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                {aiLoading
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Sparkles size={12} />}
                {aiLoading ? 'Đang tạo...' : '✨ AI Tạo mô tả'}
              </button>
            </div>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {aiError ? <p className="text-[11px] text-red-600 mt-1">{aiError}</p> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-4 items-start">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ảnh bìa hiện tại</label>
              <CoverImage src={form.cover_image_url} alt={form.title || book.title} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Upload ảnh bìa</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleSelectCoverFile}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">Định dạng: JPG/PNG/WebP, tối đa 2MB.</p>
              {uploadError ? <p className="text-[11px] text-red-600 mt-1">{uploadError}</p> : null}
            </div>
          </div>

          {formError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {formError}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-300"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Đang lưu...' : 'Lưu chi tiết'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewBookModal({ open, submitting, onClose, onSave }) {
  const [form, setForm] = useState({
    barcode: '',
    title: '',
    language: 'vi',
    publish_year: '',
    price: 0,
    author_name: '',
    publisher_name: '',
    category_name: '',
    description: '',
    cover_image_url: '',
  });
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      barcode: '',
      title: '',
      language: 'vi',
      publish_year: '',
      price: 0,
      author_name: '',
      publisher_name: '',
      category_name: '',
      description: '',
      cover_image_url: '',
    });
    setError('');
    setUploadError('');
    setAiError('');
    setAiLoading(false);
  }, [open]);

  if (!open) {
    return null;
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAiGenerate() {
    const title = form.title.trim();
    const author = form.author_name.trim();
    if (!title) {
      setAiError('Vui lòng nhập Tên sách trước khi tạo mô tả AI.');
      return;
    }
    setAiLoading(true);
    setAiError('');
    try {
      const result = await generateBookSummary(title, author);
      setField('description', result.description || '');
    } catch (err) {
      setAiError(err.message || 'AI service không phản hồi.');
    } finally {
      setAiLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!String(form.barcode).trim()) {
      setError('Vui lòng nhập barcode.');
      return;
    }
    if (!String(form.title).trim()) {
      setError('Vui lòng nhập tên sách.');
      return;
    }

    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      setError('Giá phải lớn hơn hoặc bằng 0.');
      return;
    }

    let publishYear = null;
    if (String(form.publish_year).trim()) {
      publishYear = Number(form.publish_year);
      if (!Number.isInteger(publishYear) || publishYear < 1000 || publishYear > 2100) {
        setError('Năm xuất bản phải là số nguyên từ 1000 đến 2100.');
        return;
      }
    }

    setError('');
    onSave({ ...form, price, publish_year: publishYear });
  }

  async function handleSelectCoverFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Chỉ hỗ trợ tệp ảnh.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Ảnh tối đa 2MB.');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setField('cover_image_url', dataUrl);
      setUploadError('');
    } catch (uploadErr) {
      setUploadError(uploadErr.message || 'Upload ảnh thất bại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white border border-slate-200 shadow-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">Tạo sách mới</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Đóng
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Barcode <span className="text-red-500">*</span></label>
              <input
                value={form.barcode}
                onChange={(e) => setField('barcode', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Nhập barcode"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ngôn ngữ sáng tác</label>
              <input
                value={form.language}
                onChange={(e) => setField('language', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="vi"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Năm xuất bản</label>
              <input
                type="number"
                min="1000"
                max="2100"
                value={form.publish_year}
                onChange={(e) => setField('publish_year', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="2024"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Giá <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setField('price', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tên sách <span className="text-red-500">*</span></label>
            <input
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Nhập tên sách"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tác giả</label>
              <input
                value={form.author_name}
                onChange={(e) => setField('author_name', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nhà xuất bản</label>
              <input
                value={form.publisher_name}
                onChange={(e) => setField('publisher_name', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Thể loại</label>
              <input
                value={form.category_name}
                onChange={(e) => setField('category_name', e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-600">Mô tả</label>
              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={aiLoading || submitting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                {aiLoading
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Sparkles size={12} />}
                {aiLoading ? 'Đang tạo...' : '✨ AI Tạo mô tả'}
              </button>
            </div>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {aiError ? <p className="text-[11px] text-red-600 mt-1">{aiError}</p> : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-4 items-start">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Ảnh bìa</label>
              <CoverImage src={form.cover_image_url} alt={form.title} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Upload ảnh bìa</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleSelectCoverFile}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">Định dạng: JPG/PNG/WebP, tối đa 2MB.</p>
              {uploadError ? <p className="text-[11px] text-red-600 mt-1">{uploadError}</p> : null}
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-300"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
              {submitting ? 'Đang tạo...' : 'Tạo sách mới'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [updating, setUpdating] = useState(false);
  const [creatingNewBook, setCreatingNewBook] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  async function loadBooks(showRefreshing = false) {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setErrorMessage('');
    try {
      const data = await getAllBooks();
      const normalized = (Array.isArray(data) ? data : []).map((book) => ({
        ...book,
        status: getStockStatus(Number(book.quantity || 0)),
      }));
      setBooks(normalized);
    } catch (error) {
      setErrorMessage(error.message || 'Không tải được dữ liệu kho sách từ DB.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadBooks(false);
  }, []);

  const stats = useMemo(() => {
    return {
      total: books.length,
      lowStock: books.filter((book) => book.status === 'low_stock').length,
      outOfStock: books.filter((book) => book.status === 'out_of_stock').length,
    };
  }, [books]);

  async function handleSaveDetails(payload) {
    if (!editingBook) return;

    setUpdating(true);
    setErrorMessage('');

    try {
      const response = await updateBookDetails(editingBook.id, payload);
      const updated = {
        ...response.data,
        status: getStockStatus(Number(response.data.quantity || 0)),
      };

      setBooks((prev) => prev.map((book) => (book.id === editingBook.id ? updated : book)));
      setEditingBook(null);
    } catch (error) {
      setErrorMessage(error.message || 'Cập nhật thông tin sách thất bại.');
    } finally {
      setUpdating(false);
    }
  }

  async function handleCreateBook(payload) {
    setCreatingNewBook(true);
    setErrorMessage('');

    try {
      const created = await createIncompleteBook({
        barcode: payload.barcode,
        title: payload.title,
        price: payload.price,
        language: payload.language,
        publish_year: payload.publish_year,
        cover_image_url: payload.cover_image_url,
      });

      const newBookId = created?.data?.book_id;
      if (newBookId) {
        await updateBookDetails(newBookId, {
          author_name: payload.author_name,
          publisher_name: payload.publisher_name,
          category_name: payload.category_name,
          description: payload.description,
          list_price: payload.price,
          unit_cost: payload.price,
          language: payload.language,
          publish_year: payload.publish_year,
          internal_barcode: payload.barcode,
          cover_image_url: payload.cover_image_url,
        });
      }

      setIsCreateModalOpen(false);
      await loadBooks(true);
    } catch (error) {
      setErrorMessage(error.message || 'Tạo sách mới thất bại.');
    } finally {
      setCreatingNewBook(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Kho sách</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kết nối dữ liệu thật từ DB và cập nhật chi tiết sách trực tiếp.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-medium px-3 py-2 rounded-lg"
          >
            <Plus size={14} />
            Tạo sách mới
          </button>

          <button
            type="button"
            onClick={() => loadBooks(true)}
            className="inline-flex items-center gap-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Làm mới
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : null}

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Tổng đầu sách', value: stats.total, color: 'text-indigo-600' },
          { label: 'Sắp hết hàng', value: stats.lowStock, color: 'text-orange-500' },
          { label: 'Hết hàng', value: stats.outOfStock, color: 'text-red-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Ảnh bìa</th>
                <th className="px-4 py-3 font-semibold">ID sách</th>
                <th className="px-4 py-3 font-semibold">Tên sách</th>
                <th className="px-4 py-3 font-semibold">Tác giả</th>
                <th className="px-4 py-3 font-semibold">ISBN / Barcode</th>
                <th className="px-4 py-3 font-semibold">Vị trí kho</th>
                <th className="px-4 py-3 font-semibold text-center">Số lượng</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Đang tải dữ liệu từ DB...
                    </span>
                  </td>
                </tr>
              ) : null}

              {!loading && books.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                    Chưa có dữ liệu sách trong DB.
                  </td>
                </tr>
              ) : null}

              {!loading && books.map((book) => (
                <tr key={book.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3.5">
                    <CoverImage src={book.cover_image_url} alt={book.title} />
                  </td>
                  <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">{book.id}</td>
                  <td className="px-4 py-3.5 max-w-[220px] truncate">
                    <Link to={`/inventory/${book.id}`} className="font-semibold text-gray-800 hover:text-indigo-600 transition-colors">
                      {book.title}
                    </Link>
                    {book.is_incomplete ? (
                      <p className="text-[11px] text-amber-600 mt-0.5">INCOMPLETE - cần bổ sung chi tiết</p>
                    ) : null}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {String(book.language || 'vi').toUpperCase()} {book.publish_year ? `• ${book.publish_year}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-gray-600">{book.author}</td>
                  <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">{book.isbn}</td>
                  <td className="px-4 py-3.5">
                    <WarehouseLocationsCell book={book} />
                  </td>
                  <td className="px-4 py-3.5 text-center font-bold text-gray-700">{book.quantity}</td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={book.status} />
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => setEditingBook(book)}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                    >
                      <Pencil size={13} />
                      Cập nhật chi tiết
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <EditBookModal
        open={Boolean(editingBook)}
        book={editingBook}
        submitting={updating}
        onClose={() => setEditingBook(null)}
        onSave={handleSaveDetails}
      />

      <NewBookModal
        open={isCreateModalOpen}
        submitting={creatingNewBook}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={handleCreateBook}
      />
    </div>
  );
}
