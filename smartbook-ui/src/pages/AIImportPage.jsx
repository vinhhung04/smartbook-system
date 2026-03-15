// src/pages/AIImportPage.jsx
// Trang nháº­p kho thÃ´ng minh báº±ng AI â€” Upload áº£nh â†’ PhÃ¢n tÃ­ch â†’ Äiá»n form

import { useState, useRef, useCallback } from 'react';
import {
  CloudUpload, Loader2, CheckCircle,
  Sparkles, AlertTriangle, X, RefreshCw, ScanBarcode,
} from 'lucide-react';

const AI_API_BASE    = 'http://localhost:8000';
const INVENTORY_API  = 'http://localhost:3001';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  Toast component (ná»™i bá»™, khÃ´ng cáº§n thÆ° viá»‡n ngoÃ i)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  Field definitions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const BOOK_FIELDS = [
  { label: 'TÃªn sÃ¡ch',     key: 'title',     span: true,  placeholder: 'AI sáº½ tá»± Ä‘iá»n...' },
  { label: 'TÃ¡c giáº£',      key: 'author',    span: false, placeholder: 'AI sáº½ tá»± Ä‘iá»n...' },
  { label: 'ISBN',         key: 'isbn',      span: false, placeholder: 'AI sáº½ tá»± Ä‘iá»n...' },
  { label: 'NhÃ  xuáº¥t báº£n', key: 'publisher', span: false, placeholder: 'AI sáº½ tá»± Ä‘iá»n...' },
  { label: 'GiÃ¡ bÃ¡n',      key: 'price',     span: false, placeholder: 'VD: 85.000Ä‘' },
];

const EMPTY_FORM = { title: '', author: '', isbn: '', publisher: '', price: '', quantity: '', location: '' };

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  Main Page
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function AIImportPage() {
  const { toasts, add: addToast, dismiss } = useToast();

  // â”€â”€ State bÃ¬a trÆ°á»›c â”€â”€
  const [fileObj,        setFileObj]        = useState(null);
  const [preview,        setPreview]        = useState(null);
  const [isAnalyzing,    setIsAnalyzing]    = useState(false);
  const [isDragging,     setIsDragging]     = useState(false);
  const fileInputRef = useRef(null);

  // â”€â”€ State máº·t sau â”€â”€
  const [backFileObj,    setBackFileObj]    = useState(null);
  const [backPreview,    setBackPreview]    = useState(null);
  const [isScanningBack, setIsScanningBack] = useState(false);
  const [isDraggingBack, setIsDraggingBack] = useState(false);
  const backFileInputRef = useRef(null);

  // â”€â”€ State chung â”€â”€
  const [isSaving,     setIsSaving]     = useState(false);
  const [formData,     setFormData]     = useState(EMPTY_FORM);
  const [formVisible,  setFormVisible]  = useState(false);
  const [confirmed,    setConfirmed]    = useState(false);

  // â”€â”€ Helper validate file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const validateImageFile = useCallback((file) => {
    if (!file) return false;
    if (!file.type.startsWith('image/')) {
      addToast('Vui lÃ²ng chá»n file áº£nh (PNG, JPG, WEBPâ€¦)', 'error');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      addToast('File quÃ¡ lá»›n! Tá»‘i Ä‘a 10 MB.', 'error');
      return false;
    }
    return true;
  }, [addToast]);

  const readPreview = (file, setter) => {
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target.result);
    reader.readAsDataURL(file);
  };

  // â”€â”€ Xá»­ lÃ½ bÃ¬a trÆ°á»›c â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Xá»­ lÃ½ máº·t sau â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Gá»i AI phÃ¢n tÃ­ch bÃ¬a trÆ°á»›c â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      addToast('AI nháº­n diá»‡n bÃ¬a trÆ°á»›c xong! Kiá»ƒm tra thÃ´ng tin bÃªn dÆ°á»›i.', 'success');
    } catch (err) {
      console.error(err);
      addToast(`PhÃ¢n tÃ­ch bÃ¬a trÆ°á»›c tháº¥t báº¡i: ${err.message}`, 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // â”€â”€ Gá»i AI quÃ©t máº·t sau (barcode + giÃ¡) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      // Merge vÃ o form â€” chá»‰ ghi Ä‘Ã¨ náº¿u field Ä‘ang trá»‘ng hoáº·c AI tÃ¬m tháº¥y
      setFormData((prev) => ({
        ...prev,
        isbn:  data.isbn  || prev.isbn,
        price: data.price || prev.price,
      }));
      setFormVisible(true);
      addToast(`QuÃ©t máº·t sau xong! ISBN: ${data.isbn ?? '?'} â€” GiÃ¡: ${data.price ?? '?'}`, 'success');
    } catch (err) {
      console.error(err);
      addToast(`QuÃ©t máº·t sau tháº¥t báº¡i: ${err.message}`, 'error');
    } finally {
      setIsScanningBack(false);
    }
  };

  // â”€â”€ Xá»­ lÃ½ thay Ä‘á»•i field â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleFieldChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  // â”€â”€ XÃ¡c nháº­n nháº­p kho â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!formData.quantity || Number(formData.quantity) < 1) {
      addToast('Vui lÃ²ng nháº­p sá»‘ lÆ°á»£ng há»£p lá»‡.', 'error');
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
      addToast(`ÄÃ£ nháº­p kho thÃ nh cÃ´ng: "${formData.title}"`, 'success', 6000);
    } catch (err) {
      addToast(`LÆ°u tháº¥t báº¡i: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // â”€â”€ Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleReset = () => {
    setFileObj(null);     setPreview(null);
    setBackFileObj(null); setBackPreview(null);
    setFormData(EMPTY_FORM);
    setFormVisible(false);
    setConfirmed(false);
    if (fileInputRef.current)     fileInputRef.current.value = '';
    if (backFileInputRef.current) backFileInputRef.current.value = '';
  };

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Toast */}
      <Toast toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Nháº­p kho nhanh AI</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Táº£i lÃªn áº£nh bÃ¬a trÆ°á»›c vÃ  máº·t sau â€” AI tá»± Ä‘á»™ng Ä‘iá»n thÃ´ng tin vÃ o form
        </p>
      </div>

      {/* â”€â”€ UPLOAD ZONE: 2 Cá»˜T â”€â”€ */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          BÆ°á»›c 1 â€” Táº£i áº£nh lÃªn
        </h2>

        <div className="grid grid-cols-2 gap-4">
          {/* â”€â”€ BÃŒA TRÆ¯á»šC â”€â”€ */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-indigo-600 flex items-center gap-1.5">
              <Sparkles size={13} /> BÃ¬a trÆ°á»›c
              <span className="text-gray-400 font-normal">(tÃªn sÃ¡ch, tÃ¡c giáº£â€¦)</span>
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
                  <p className="text-[11px] text-gray-400">Nháº¥n Ä‘á»ƒ thay áº£nh</p>
                  <span className="absolute top-1.5 right-1.5 bg-indigo-100 text-indigo-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
                    {fileObj?.name}
                  </span>
                </>
              ) : (
                <>
                  <CloudUpload size={24} className="text-indigo-300" />
                  <p className="text-xs text-center text-gray-500">
                    KÃ©o tháº£ hoáº·c <span className="text-indigo-600 underline">chá»n file</span>
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
                ? <><Loader2 size={13} className="animate-spin" /> Äang phÃ¢n tÃ­ch...</>
                : <><Sparkles size={13} /> PhÃ¢n tÃ­ch bÃ¬a trÆ°á»›c</>}
            </button>
          </div>

          {/* â”€â”€ Máº¶T SAU â”€â”€ */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
              <ScanBarcode size={13} /> Máº·t sau
              <span className="text-gray-400 font-normal">(barcode, giÃ¡ tiá»n)</span>
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
                  <p className="text-[11px] text-gray-400">Nháº¥n Ä‘á»ƒ thay áº£nh</p>
                  <span className="absolute top-1.5 right-1.5 bg-emerald-100 text-emerald-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full truncate max-w-[100px]">
                    {backFileObj?.name}
                  </span>
                </>
              ) : (
                <>
                  <ScanBarcode size={24} className="text-emerald-300" />
                  <p className="text-xs text-center text-gray-500">
                    KÃ©o tháº£ hoáº·c <span className="text-emerald-600 underline">chá»n file</span>
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
                ? <><Loader2 size={13} className="animate-spin" /> Äang quÃ©t...</>
                : <><ScanBarcode size={13} /> QuÃ©t máº·t sau</>}
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
                ? 'AI Ä‘ang Ä‘á»c bÃ¬a trÆ°á»›c â€” cÃ³ thá»ƒ máº¥t 10â€“20 giÃ¢y...'
                : 'AI Ä‘ang quÃ©t máº·t sau (barcode, giÃ¡) â€” chá» xÃ­u...'}
            </p>
          </div>
        )}
      </div>

      {/* â”€â”€ FORM Káº¾T QUáº¢ â”€â”€ */}
      {formVisible && !confirmed && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-green-500" />
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                BÆ°á»›c 2 â€” Kiá»ƒm tra & xÃ¡c nháº­n thÃ´ng tin
              </h2>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              title="PhÃ¢n tÃ­ch láº¡i"
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
            >
              <RefreshCw size={13} />
              PhÃ¢n tÃ­ch láº¡i
            </button>
          </div>

          <form onSubmit={handleConfirm} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {BOOK_FIELDS.map(({ label, key, span, placeholder }) => (
                <div key={key} className={span ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {label}
                    {!formData[key] && (
                      <span className="ml-1.5 text-orange-400 font-normal">(AI khÃ´ng Ä‘á»c Ä‘Æ°á»£c)</span>
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
                  />
                </div>
              ))}

              {/* Sá»‘ lÆ°á»£ng */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Sá»‘ lÆ°á»£ng nháº­p <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.quantity}
                  onChange={(e) => handleFieldChange('quantity', e.target.value)}
                  placeholder="Nháº­p sá»‘ lÆ°á»£ng..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Vá»‹ trÃ­ kho */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Vá»‹ trÃ­ kho</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleFieldChange('location', e.target.value)}
                  placeholder="VD: Ká»‡ A-1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2
                bg-green-600 hover:bg-green-700 disabled:bg-green-400
                text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
            >
              {isSaving ? (
                <><Loader2 size={15} className="animate-spin" /> Äang lÆ°u...</>
              ) : (
                <><CheckCircle size={15} /> XÃ¡c nháº­n nháº­p kho</>
              )}
            </button>
          </form>
        </div>
      )}

      {/* â”€â”€ THÃ€NH CÃ”NG â”€â”€ */}
      {confirmed && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={28} className="text-green-600" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-green-800">Nháº­p kho thÃ nh cÃ´ng!</p>
            <p className="text-sm text-green-600 mt-0.5">
              <strong>{formData.title || 'SÃ¡ch'}</strong> Ã— <strong>{formData.quantity}</strong> báº£n
              {formData.location && <> â€” vá»‹ trÃ­ <strong>{formData.location}</strong></>}
            </p>
          </div>
          <button
            onClick={handleReset}
            className="flex-shrink-0 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Nháº­p tiáº¿p
          </button>
        </div>
      )}
    </div>
  );
}
