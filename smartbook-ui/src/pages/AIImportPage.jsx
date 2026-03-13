// src/pages/AIImportPage.jsx
<<<<<<< HEAD
// Trang nhập kho thông minh bằng AI — Upload ảnh → Phân tích → Điền form

import { useState, useRef, useCallback } from 'react';
import {
  CloudUpload, Loader2, CheckCircle,
  Sparkles, AlertTriangle, X, RefreshCw, ScanBarcode,
} from 'lucide-react';

const AI_API_BASE    = 'http://localhost:8000';
const INVENTORY_API  = 'http://localhost:3001';

// ─────────────────────────────────────────────────────────────
//  Toast component (nội bộ, không cần thư viện ngoài)
// ─────────────────────────────────────────────────────────────
function Toast({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm pointer-events-auto
            transition-all duration-300 animate-fade-in
            ${t.type === 'success' ? 'bg-green-600 text-white' : ''}
            ${t.type === 'error'   ? 'bg-red-600   text-white' : ''}
            ${t.type === 'info'    ? 'bg-indigo-600 text-white' : ''}
          `}
        >
          {t.type === 'success' && <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />}
          {t.type === 'error'   && <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />}
          {t.type === 'info'    && <Sparkles size={16} className="flex-shrink-0 mt-0.5" />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-1 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  return { toasts, add, dismiss };
}

// ─────────────────────────────────────────────────────────────
//  Field definitions
// ─────────────────────────────────────────────────────────────
const BOOK_FIELDS = [
  { label: 'Tên sách',     key: 'title',     span: true,  placeholder: 'AI sẽ tự điền...' },
  { label: 'Tác giả',      key: 'author',    span: false, placeholder: 'AI sẽ tự điền...' },
  { label: 'ISBN',         key: 'isbn',      span: false, placeholder: 'AI sẽ tự điền...' },
  { label: 'Nhà xuất bản', key: 'publisher', span: false, placeholder: 'AI sẽ tự điền...' },
  { label: 'Giá bán',      key: 'price',     span: false, placeholder: 'VD: 85.000đ' },
];

const EMPTY_FORM = { title: '', author: '', isbn: '', publisher: '', price: '', quantity: '', location: '' };

// ─────────────────────────────────────────────────────────────
//  Main Page
// ─────────────────────────────────────────────────────────────
export default function AIImportPage() {
  const { toasts, add: addToast, dismiss } = useToast();

  // ── State bìa trước ──
  const [fileObj,        setFileObj]        = useState(null);
  const [preview,        setPreview]        = useState(null);
  const [isAnalyzing,    setIsAnalyzing]    = useState(false);
  const [isDragging,     setIsDragging]     = useState(false);
  const fileInputRef = useRef(null);

  // ── State mặt sau ──
  const [backFileObj,    setBackFileObj]    = useState(null);
  const [backPreview,    setBackPreview]    = useState(null);
  const [isScanningBack, setIsScanningBack] = useState(false);
  const [isDraggingBack, setIsDraggingBack] = useState(false);
  const backFileInputRef = useRef(null);

  // ── State chung ──
  const [isSaving,     setIsSaving]     = useState(false);
  const [formData,     setFormData]     = useState(EMPTY_FORM);
  const [formVisible,  setFormVisible]  = useState(false);
  const [confirmed,    setConfirmed]    = useState(false);

  // ── Helper validate file ─────────────────────────────────
  const validateImageFile = useCallback((file) => {
    if (!file) return false;
    if (!file.type.startsWith('image/')) {
      addToast('Vui lòng chọn file ảnh (PNG, JPG, WEBP…)', 'error');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      addToast('File quá lớn! Tối đa 10 MB.', 'error');
      return false;
    }
    return true;
  }, [addToast]);

  const readPreview = (file, setter) => {
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target.result);
    reader.readAsDataURL(file);
  };

  // ── Xử lý bìa trước ─────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!validateImageFile(file)) return;
    setFileObj(file);
    setFormVisible(false);
    setConfirmed(false);
    setFormData(EMPTY_FORM);
    setBackFileObj(null);
    setBackPreview(null);
    readPreview(file, setPreview);
  }, [validateImageFile]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  // ── Xử lý mặt sau ───────────────────────────────────────
  const handleBackFile = useCallback((file) => {
    if (!validateImageFile(file)) return;
    setBackFileObj(file);
    readPreview(file, setBackPreview);
  }, [validateImageFile]);

  const handleBackDrop = useCallback((e) => {
    e.preventDefault();
    setIsDraggingBack(false);
    handleBackFile(e.dataTransfer.files[0]);
  }, [handleBackFile]);

  // ── Gọi AI phân tích bìa trước ───────────────────────────
  const handleAnalyze = async () => {
    if (!fileObj || isAnalyzing) return;
    setIsAnalyzing(true);
    setFormVisible(false);

    try {
      const fd = new FormData();
      fd.append('file', fileObj, fileObj.name);
      const res = await fetch(`${AI_API_BASE}/recognize-book`, { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${res.status}`); }
      const data = await res.json();
      console.log('Front cover AI:', data);
      setFormData((prev) => ({
        ...prev,
        title:     data.title     ?? '',
        author:    data.author    ?? '',
        isbn:      data.isbn      ?? '',
        publisher: data.publisher ?? '',
      }));
      setFormVisible(true);
      addToast('AI nhận diện bìa trước xong! Kiểm tra thông tin bên dưới.', 'success');
    } catch (err) {
      console.error(err);
      addToast(`Phân tích bìa trước thất bại: ${err.message}`, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Gọi AI quét mặt sau (barcode + giá) ──────────────────
  const handleScanBack = async () => {
    if (!backFileObj || isScanningBack) return;
    setIsScanningBack(true);

    try {
      const fd = new FormData();
      fd.append('file', backFileObj, backFileObj.name);
      const res = await fetch(`${AI_API_BASE}/scan-back-cover`, { method: 'POST', body: fd });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${res.status}`); }
      const data = await res.json();
      console.log('Back cover AI:', data);
      // Merge vào form — chỉ ghi đè nếu field đang trống hoặc AI tìm thấy
      setFormData((prev) => ({
        ...prev,
        isbn:  data.isbn  || prev.isbn,
        price: data.price || prev.price,
      }));
      setFormVisible(true);
      addToast(`Quét mặt sau xong! ISBN: ${data.isbn ?? '?'} — Giá: ${data.price ?? '?'}`, 'success');
    } catch (err) {
      console.error(err);
      addToast(`Quét mặt sau thất bại: ${err.message}`, 'error');
    } finally {
      setIsScanningBack(false);
    }
  };

  // ── Xử lý thay đổi field ─────────────────────────────────
  const handleFieldChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  // ── Xác nhận nhập kho ────────────────────────────────────
  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!formData.quantity || Number(formData.quantity) < 1) {
      addToast('Vui lòng nhập số lượng hợp lệ.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${INVENTORY_API}/api/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn:      formData.isbn      || null,
          title:     formData.title,
          author:    formData.author    || null,
          publisher: formData.publisher || null,
          quantity:  Number(formData.quantity),
          location:  formData.location  || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmed(true);
      addToast(`Đã nhập kho thành công: "${formData.title}"`, 'success', 6000);
    } catch (err) {
      addToast(`Lưu thất bại: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────
  const handleReset = () => {
    setFileObj(null);     setPreview(null);
    setBackFileObj(null); setBackPreview(null);
    setFormData(EMPTY_FORM);
    setFormVisible(false);
    setConfirmed(false);
    if (fileInputRef.current)     fileInputRef.current.value = '';
    if (backFileInputRef.current) backFileInputRef.current.value = '';
  };

  // ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Toast */}
      <Toast toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Nhập kho nhanh AI</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Tải lên ảnh bìa trước và mặt sau — AI tự động điền thông tin vào form
        </p>
      </div>

      {/* ── UPLOAD ZONE: 2 CỘT ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Bước 1 — Tải ảnh lên
        </h2>

        <div className="grid grid-cols-2 gap-4">
          {/* ── BÌA TRƯỚC ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-indigo-600 flex items-center gap-1.5">
              <Sparkles size={13} /> Bìa trước
              <span className="text-gray-400 font-normal">(tên sách, tác giả…)</span>
            </p>
            <div
              onClick={() => !isAnalyzing && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center
                cursor-pointer transition-all duration-200 gap-2 min-h-[160px]
                ${isDragging ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
                  : preview ? 'border-indigo-300 bg-slate-50'
                  : 'border-gray-300 hover:border-indigo-400 hover:bg-slate-50'}
                ${isAnalyzing ? 'pointer-events-none opacity-60' : ''}`}
            >
              {preview ? (
                <>
                  <img src={preview} alt="front" className="max-h-32 object-contain rounded-lg shadow" />
                  <p className="text-[11px] text-gray-400">Nhấn để thay ảnh</p>
                  <span className="absolute top-1.5 right-1.5 bg-indigo-100 text-indigo-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
                    {fileObj?.name}
                  </span>
                </>
              ) : (
                <>
                  <CloudUpload size={24} className="text-indigo-300" />
                  <p className="text-xs text-center text-gray-500">
                    Kéo thả hoặc <span className="text-indigo-600 underline">chọn file</span>
                  </p>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => handleFile(e.target.files[0])} />
            <button
              onClick={handleAnalyze}
              disabled={!fileObj || isAnalyzing}
              className="w-full flex items-center justify-center gap-1.5
                bg-gradient-to-r from-violet-500 to-indigo-600
                hover:from-violet-600 hover:to-indigo-700
                disabled:from-violet-300 disabled:to-indigo-300
                text-white font-semibold py-2 rounded-xl text-xs
                shadow-md shadow-violet-200 transition-all active:scale-[0.98]"
            >
              {isAnalyzing
                ? <><Loader2 size={13} className="animate-spin" /> Đang phân tích...</>
                : <><Sparkles size={13} /> Phân tích bìa trước</>}
            </button>
          </div>

          {/* ── MẶT SAU ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
              <ScanBarcode size={13} /> Mặt sau
              <span className="text-gray-400 font-normal">(barcode, giá tiền)</span>
            </p>
            <div
              onClick={() => !isScanningBack && backFileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingBack(true); }}
              onDragLeave={() => setIsDraggingBack(false)}
              onDrop={handleBackDrop}
              className={`relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center
                cursor-pointer transition-all duration-200 gap-2 min-h-[160px]
                ${isDraggingBack ? 'border-emerald-500 bg-emerald-50 scale-[1.01]'
                  : backPreview ? 'border-emerald-300 bg-slate-50'
                  : 'border-gray-300 hover:border-emerald-400 hover:bg-slate-50'}
                ${isScanningBack ? 'pointer-events-none opacity-60' : ''}`}
            >
              {backPreview ? (
                <>
                  <img src={backPreview} alt="back" className="max-h-32 object-contain rounded-lg shadow" />
                  <p className="text-[11px] text-gray-400">Nhấn để thay ảnh</p>
                  <span className="absolute top-1.5 right-1.5 bg-emerald-100 text-emerald-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
                    {backFileObj?.name}
                  </span>
                </>
              ) : (
                <>
                  <ScanBarcode size={24} className="text-emerald-300" />
                  <p className="text-xs text-center text-gray-500">
                    Kéo thả hoặc <span className="text-emerald-600 underline">chọn file</span>
                  </p>
                </>
              )}
            </div>
            <input ref={backFileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => handleBackFile(e.target.files[0])} />
            <button
              onClick={handleScanBack}
              disabled={!backFileObj || isScanningBack}
              className="w-full flex items-center justify-center gap-1.5
                bg-gradient-to-r from-emerald-500 to-teal-600
                hover:from-emerald-600 hover:to-teal-700
                disabled:from-emerald-300 disabled:to-teal-300
                text-white font-semibold py-2 rounded-xl text-xs
                shadow-md shadow-emerald-200 transition-all active:scale-[0.98]"
            >
              {isScanningBack
                ? <><Loader2 size={13} className="animate-spin" /> Đang quét...</>
                : <><ScanBarcode size={13} /> Quét mặt sau</>}
            </button>
          </div>
        </div>

        {/* Loading indicators */}
        {(isAnalyzing || isScanningBack) && (
          <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border
            ${isAnalyzing ? 'bg-violet-50 border-violet-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <div className="flex gap-1">
              {[0,1,2].map((i) => (
                <span key={i}
                  className={`w-2 h-2 rounded-full animate-bounce
                    ${isAnalyzing ? 'bg-violet-400' : 'bg-emerald-400'}`}
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <p className={`text-xs font-medium
              ${isAnalyzing ? 'text-violet-700' : 'text-emerald-700'}`}>
              {isAnalyzing
                ? 'AI đang đọc bìa trước — có thể mất 10–20 giây...'
                : 'AI đang quét mặt sau (barcode, giá) — chờ xíu...'}
            </p>
          </div>
        )}
      </div>

      {/* ── FORM KẾT QUẢ ── */}
      {formVisible && !confirmed && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-green-500" />
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Bước 2 — Kiểm tra & xác nhận thông tin
              </h2>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              title="Phân tích lại"
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
            >
              <RefreshCw size={13} />
              Phân tích lại
            </button>
          </div>

          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {BOOK_FIELDS.map(({ label, key, span, placeholder }) => (
                <div key={key} className={span ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {label}
                    {!formData[key] && (
                      <span className="ml-1.5 text-orange-400 font-normal">(AI không đọc được)</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={formData[key]}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    placeholder={placeholder}
                    className={`w-full border rounded-lg px-3 py-2 text-sm text-gray-800
                      focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50
                      ${formData[key] ? 'border-green-200' : 'border-orange-200'}
                    `}
=======
// Trang nhập kho thông minh bằng AI - Upload ảnh → Phân tích → Điền form

import { useState, useRef } from 'react';
import { CloudUpload, Loader2, CheckCircle, ImageIcon } from 'lucide-react';

// =====================  MOCK AI RESULT  =====================
const AI_MOCK_RESULT = {
  title:     'Đắc Nhân Tâm',
  author:    'Dale Carnegie',
  isbn:      '9786049228438',
  publisher: 'NXB Tổng hợp TP.HCM',
  year:      '2023',
};

// =====================  MAIN PAGE  =====================
export default function AIImportPage() {
  const [preview, setPreview]       = useState(null);   // base64 ảnh preview
  const [isLoading, setIsLoading]   = useState(false);  // đang phân tích AI
  const [aiResult, setAiResult]     = useState(null);   // kết quả nhận diện
  const [quantity, setQuantity]     = useState('');     // số lượng nhập tay
  const [confirmed, setConfirmed]   = useState(false);  // đã xác nhận
  const [isDragging, setIsDragging] = useState(false);  // drag-over state
  const fileInputRef = useRef(null);

  // --- Xử lý chọn / drop file ---
  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
    setAiResult(null);
    setConfirmed(false);
    setQuantity('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  // --- Giả lập gọi AI (setTimeout 2s) ---
  const handleAnalyze = () => {
    if (!preview) return;
    setIsLoading(true);
    setAiResult(null);
    setTimeout(() => {
      setAiResult(AI_MOCK_RESULT);
      setIsLoading(false);
    }, 2000);
  };

  // --- Xác nhận nhập kho ---
  const handleConfirm = (e) => {
    e.preventDefault();
    setConfirmed(true);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Nhập kho nhanh AI</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Tải lên ảnh bìa sách hoặc mã vạch — AI sẽ tự động nhận diện thông tin
        </p>
      </div>

      {/* ===== UPLOAD ZONE ===== */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          1. Tải ảnh lên
        </h2>

        {/* Drag & Drop area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors gap-3
            ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-slate-50'}`}
        >
          {preview ? (
            <>
              <img
                src={preview}
                alt="preview"
                className="h-40 object-contain rounded-lg shadow"
              />
              <p className="text-xs text-gray-400">Nhấn để thay ảnh khác</p>
            </>
          ) : (
            <>
              <CloudUpload size={40} className="text-indigo-400" />
              <p className="text-sm font-medium text-gray-600">
                Kéo & thả ảnh vào đây, hoặc <span className="text-indigo-600 underline">chọn file</span>
              </p>
              <p className="text-xs text-gray-400">PNG, JPG, WEBP — tối đa 10MB</p>
            </>
          )}
        </div>

        {/* Input file ẩn */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />

        {/* Nút phân tích */}
        <button
          onClick={handleAnalyze}
          disabled={!preview || isLoading}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              AI đang phân tích...
            </>
          ) : (
            <>
              <ImageIcon size={16} />
              Phân tích ảnh
            </>
          )}
        </button>
      </div>

      {/* ===== AI RESULT FORM ===== */}
      {aiResult && !confirmed && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} className="text-green-500" />
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              2. Kết quả nhận diện — Vui lòng kiểm tra lại
            </h2>
          </div>

          <form onSubmit={handleConfirm} className="space-y-4">
            {/* Grid 2 cột */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Tên sách',     key: 'title',     span: true },
                { label: 'Tác giả',      key: 'author' },
                { label: 'ISBN',         key: 'isbn' },
                { label: 'Nhà xuất bản', key: 'publisher' },
                { label: 'Năm xuất bản', key: 'year' },
              ].map(({ label, key, span }) => (
                <div key={key} className={span ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type="text"
                    defaultValue={aiResult[key]}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
                  />
                </div>
              ))}

<<<<<<< HEAD
              {/* Số lượng */}
=======
              {/* Số lượng — nhập tay */}
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Số lượng nhập <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  required
<<<<<<< HEAD
                  value={formData.quantity}
                  onChange={(e) => handleFieldChange('quantity', e.target.value)}
=======
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
                  placeholder="Nhập số lượng..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Vị trí kho */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Vị trí kho</label>
                <input
                  type="text"
<<<<<<< HEAD
                  value={formData.location}
                  onChange={(e) => handleFieldChange('location', e.target.value)}
=======
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
                  placeholder="VD: Kệ A-1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
<<<<<<< HEAD
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2
                bg-green-600 hover:bg-green-700 disabled:bg-green-400
                text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
            >
              {isSaving ? (
                <><Loader2 size={15} className="animate-spin" /> Đang lưu...</>
              ) : (
                <><CheckCircle size={15} /> Xác nhận nhập kho</>
              )}
=======
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
            >
              ✓ Xác nhận nhập kho
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
            </button>
          </form>
        </div>
      )}

<<<<<<< HEAD
      {/* ── THÀNH CÔNG ── */}
      {confirmed && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={28} className="text-green-600" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-green-800">Nhập kho thành công!</p>
            <p className="text-sm text-green-600 mt-0.5">
              <strong>{formData.title || 'Sách'}</strong> × <strong>{formData.quantity}</strong> bản
              {formData.location && <> — vị trí <strong>{formData.location}</strong></>}
            </p>
          </div>
          <button
            onClick={handleReset}
            className="flex-shrink-0 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition-colors"
=======
      {/* ===== SUCCESS STATE ===== */}
      {confirmed && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 flex items-center gap-4">
          <CheckCircle size={36} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Nhập kho thành công!</p>
            <p className="text-sm text-green-600 mt-0.5">
              Sách <strong>{aiResult?.title}</strong> đã được thêm vào kho với số lượng{' '}
              <strong>{quantity}</strong> bản.
            </p>
          </div>
          <button
            onClick={() => { setPreview(null); setAiResult(null); setConfirmed(false); setQuantity(''); }}
            className="ml-auto text-xs text-green-700 underline hover:text-green-900"
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
          >
            Nhập tiếp
          </button>
        </div>
      )}
    </div>
  );
}
