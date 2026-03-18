// src/components/ScannerModal.jsx
// Modal quÃ©t mÃ£ váº¡ch / QR Code dÃ¹ng html5-qrcode
// + Nháº­n diá»‡n bÃ¬a sÃ¡ch báº±ng AI (Ollama/LLaVA)

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, KeyboardIcon, Loader2, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { findBookByBarcode } from '../services/api';

const SCANNER_ID = 'reader';
const AI_API_BASE = import.meta.env.VITE_AI_BASE_URL || 'http://localhost:8000';

// â”€â”€â”€ Tráº¡ng thÃ¡i loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LOADING_STATE = {
  NONE:    'none',
  BARCODE: 'barcode',   // Ä‘ang tra cá»©u barcode
  AI:      'ai',        // Ä‘ang gá»i AI nháº­n diá»‡n bÃ¬a
};

export default function ScannerModal({ isOpen, onClose, onScanSuccess, allowUnknownBarcode = false }) {
  const scannerRef   = useRef(null);
  const [manualBarcode,    setManualBarcode]    = useState('');
  const [loadingState,     setLoadingState]     = useState(LOADING_STATE.NONE);
  const [cameraError,      setCameraError]      = useState(null);
  const [cameras,          setCameras]          = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [aiError,          setAiError]          = useState(null);

  const isLoading = loadingState !== LOADING_STATE.NONE;

  function buildScannedBookPayload(data, fallbackBarcode) {
    const safeBarcode = data?.barcode || data?.isbn || fallbackBarcode || '';
    return {
      barcode: safeBarcode,
      isbn: safeBarcode,
      title: data?.title ?? '(Khong co tieu de)',
      author: data?.author ?? 'Chua cap nhat',
      publisher: data?.publisher ?? '',
      description: data?.description ?? '',
      coverImage: data?.coverImage ?? data?.cover_image ?? data?.cover_image_url ?? '',
      price: data?.price ?? data?.list_price ?? data?.unit_cost ?? 0,
      variant_id: data?.variant_id ?? null,
      unit_cost: data?.unit_cost ?? 0,
      list_price: data?.list_price ?? 0,
      is_incomplete: Boolean(data?.is_incomplete),
      book_id: data?.book_id ?? null,
    };
  }

  // â”€â”€â”€ Dá»«ng camera sáº¡ch sáº½ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
  }, []);

  // â”€â”€â”€ Tra cá»©u sÃ¡ch qua barcode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleScanSuccess = useCallback(async (code) => {
    if (!code || loadingState !== LOADING_STATE.NONE) return;
    const normalizedCode = String(code).trim();
    if (!normalizedCode) return;
    setLoadingState(LOADING_STATE.BARCODE);
    setAiError(null);
    try {
      const data = await findBookByBarcode(normalizedCode);
      const bookData = buildScannedBookPayload(data, normalizedCode);

      await stopCamera();
      onScanSuccess(bookData);
      onClose();
    } catch (err) {
      const message = String(err?.message || '');

      if ((/not found/i.test(message) || /404/.test(message)) && allowUnknownBarcode) {
        await stopCamera();
        onScanSuccess({
          barcode: normalizedCode,
          isbn: normalizedCode,
          title: '',
          author: '',
          price: 0,
          notFound: true,
        });
        onClose();
        return;
      }

      console.error('Lookup error:', err);
      setAiError(message || 'Khong the tra cuu sach theo barcode.');
    } finally {
      setLoadingState(LOADING_STATE.NONE);
    }
  }, [allowUnknownBarcode, loadingState, stopCamera, onScanSuccess, onClose]);

  // â”€â”€â”€ Chá»¥p frame tá»« <video> cá»§a html5-qrcode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const captureFrameAsBlob = useCallback(() => {
    return new Promise((resolve, reject) => {
      const container = document.getElementById(SCANNER_ID);
      if (!container) return reject(new Error('KhÃ´ng tÃ¬m tháº¥y viewport camera.'));

      const video = container.querySelector('video');
      if (!video || video.readyState < 2) {
        return reject(new Error('Camera chÆ°a sáºµn sÃ ng. HÃ£y Ä‘á»£i vÃ i giÃ¢y rá»“i thá»­ láº¡i.'));
      }

      const canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('KhÃ´ng thá»ƒ chuyá»ƒn Ä‘á»•i khung hÃ¬nh thÃ nh áº£nh.'));
        },
        'image/jpeg',
        0.92,
      );
    });
  }, []);

  // â”€â”€â”€ Gá»­i áº£nh lÃªn AI service Ä‘á»ƒ nháº­n diá»‡n bÃ¬a sÃ¡ch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleAIScan = useCallback(async () => {
    if (isLoading) return;
    setAiError(null);
    setLoadingState(LOADING_STATE.AI);

    try {
      const blob = await captureFrameAsBlob();

      const formData = new FormData();
      formData.append('file', blob, 'cover.jpg');

      const res = await fetch(`${AI_API_BASE}/recognize-book`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`AI service lá»—i (${res.status})${errText ? ': ' + errText : ''}`);
      }

      const data = await res.json();
      console.log('AI Recognition Response:', data);

      const bookData = buildScannedBookPayload(data, data?.isbn || '');

      await stopCamera();
      onScanSuccess(bookData);
      onClose();
    } catch (err) {
      console.error('AI scan error:', err);
      setAiError(err.message || 'AI nháº­n diá»‡n tháº¥t báº¡i. HÃ£y thá»­ láº¡i.');
    } finally {
      setLoadingState(LOADING_STATE.NONE);
    }
  }, [isLoading, captureFrameAsBlob, stopCamera, onScanSuccess, onClose]);

  // â”€â”€â”€ Khá»Ÿi Ä‘á»™ng camera theo deviceId â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const startCameraById = useCallback(async (deviceId) => {
    await stopCamera();
    setCameraError(null);
    setAiError(null);

    try {
      const qr = new Html5Qrcode(SCANNER_ID, { verbose: false });
      await qr.start(
        deviceId,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => { handleScanSuccess(decodedText); },
        () => {},
      );
      scannerRef.current = qr;
    } catch (err) {
      console.error('Camera start error:', err);
      const msg = err?.name === 'NotAllowedError'
        ? 'TrÃ¬nh duyá»‡t bá»‹ cháº·n quyá»n Camera. HÃ£y cho phÃ©p trong Settings rá»“i thá»­ láº¡i.'
        : 'KhÃ´ng má»Ÿ Ä‘Æ°á»£c Camera nÃ y. HÃ£y thá»­ chá»n camera khÃ¡c.';
      setCameraError(msg);
    }
  }, [stopCamera, handleScanSuccess]);

  // â”€â”€â”€ Äá»•i camera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCameraChange = async (e) => {
    const id = e.target.value;
    setSelectedCameraId(id);
    await startCameraById(id);
  };

  // â”€â”€â”€ Nháº­p mÃ£ thá»§ cÃ´ng â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleManualSubmit = () => {
    const trimmed = manualBarcode.trim();
    if (!trimmed) return;
    setManualBarcode('');
    handleScanSuccess(trimmed);
  };

  // â”€â”€â”€ Khá»Ÿi táº¡o khi modal má»Ÿ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const initCamera = async () => {
      setCameraError(null);
      setAiError(null);

      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const defaultDeviceId = tempStream.getVideoTracks()[0]?.getSettings()?.deviceId;
        tempStream.getTracks().forEach((t) => t.stop());

        if (cancelled) return;

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));

        if (cancelled) return;

        if (videoDevices.length === 0) {
          setCameraError('KhÃ´ng tÃ¬m tháº¥y Camera nÃ o. Vui lÃ²ng nháº­p mÃ£ thá»§ cÃ´ng.');
          return;
        }

        setCameras(videoDevices);
        const startId = defaultDeviceId ?? videoDevices[0].id;
        setSelectedCameraId(startId);
        await startCameraById(startId);
      } catch (err) {
        console.error('Camera init error:', err);
        if (!cancelled) {
          const msg = err?.name === 'NotAllowedError'
            ? 'TrÃ¬nh duyá»‡t bá»‹ cháº·n quyá»n Camera. HÃ£y cho phÃ©p trong Settings rá»“i thá»­ láº¡i.'
            : 'KhÃ´ng má»Ÿ Ä‘Æ°á»£c Camera. Vui lÃ²ng nháº­p mÃ£ thá»§ cÃ´ng.';
          setCameraError(msg);
        }
      }
    };

    const timer = setTimeout(initCamera, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Clean-up: dá»«ng camera khi unmount / Ä‘Ã³ng modal
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // â”€â”€â”€ ÄÃ³ng modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleClose = async () => {
    await stopCamera();
    setManualBarcode('');
    setLoadingState(LOADING_STATE.NONE);
    setCameraError(null);
    setAiError(null);
    setCameras([]);
    setSelectedCameraId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Ná»n má» */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isLoading ? handleClose : undefined}
      />

      {/* Card modal */}
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* â”€â”€ Header â”€â”€ */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-800">QuÃ©t mÃ£ váº¡ch / QR Code</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {/* â”€â”€ Loading overlay â”€â”€ */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/85 backdrop-blur-sm rounded-2xl gap-4 px-6">
            {/* VÃ²ng xoay Ä‘a lá»›p cho AI loading */}
            <div className="relative flex items-center justify-center">
              <Loader2
                size={40}
                className={`animate-spin ${loadingState === LOADING_STATE.AI ? 'text-violet-500' : 'text-indigo-600'}`}
              />
              {loadingState === LOADING_STATE.AI && (
                <span className="absolute text-lg">âœ¨</span>
              )}
            </div>
            <div className="text-center">
              {loadingState === LOADING_STATE.AI ? (
                <>
                  <p className="text-sm font-semibold text-violet-700">
                    AI Ä‘ang nhÃ¬n bÃ¬a sÃ¡ch, chá» xÃ­u nhÃ©...
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    QuÃ¡ trÃ¬nh cÃ³ thá»ƒ máº¥t 10 â€“ 20 giÃ¢y
                  </p>
                </>
              ) : (
                <p className="text-sm font-medium text-gray-700">Äang tra cá»©u...</p>
              )}
            </div>
          </div>
        )}

        {/* â”€â”€ Camera viewport â”€â”€ */}
        <div className="px-4 pt-4">
          {/* Dropdown chá»n camera */}
          {cameras.length > 1 && !cameraError && (
            <div className="flex items-center gap-2 mb-3">
              <Camera size={14} className="text-indigo-500 flex-shrink-0" />
              <select
                value={selectedCameraId ?? ''}
                onChange={handleCameraChange}
                disabled={isLoading}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {cameras.map((cam) => (
                  <option key={cam.id} value={cam.id}>{cam.label}</option>
                ))}
              </select>
              <button
                onClick={() => selectedCameraId && startCameraById(selectedCameraId)}
                disabled={isLoading}
                title="Thá»­ láº¡i"
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          )}

          {cameraError ? (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3">
              <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-red-700 font-medium">{cameraError}</p>
                {cameras.length > 1 && (
                  <p className="text-xs text-red-500 mt-1">HÃ£y thá»­ chá»n camera khÃ¡c tá»« danh sÃ¡ch phÃ­a trÃªn.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500 mb-3 text-center">
              HÆ°á»›ng camera vÃ o mÃ£ váº¡ch cá»§a sÃ¡ch. Há»‡ thá»‘ng sáº½ tá»± Ä‘á»™ng nháº­n diá»‡n.
            </p>
          )}

          {/* html5-qrcode render vÃ o Ä‘Ã¢y â€” giá»¯ div dÃ¹ cÃ³ lá»—i */}
          <div id={SCANNER_ID} className={`w-full ${cameraError ? 'hidden' : ''}`} />

          {/* â”€â”€ NÃºt AI Scan â”€â”€ */}
          {!cameraError && (
            <div className="mt-3 mb-1">
              {/* ThÃ´ng bÃ¡o lá»—i AI (náº¿u cÃ³) */}
              {aiError && (
                <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-2">
                  <AlertTriangle size={14} className="text-orange-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-700">{aiError}</p>
                </div>
              )}

              <button
                onClick={handleAIScan}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                           bg-gradient-to-r from-violet-500 to-indigo-500
                           hover:from-violet-600 hover:to-indigo-600
                           disabled:from-violet-300 disabled:to-indigo-300
                           text-white text-sm font-semibold rounded-xl
                           shadow-md shadow-violet-200
                           transition-all duration-200 active:scale-[0.98]"
              >
                <Sparkles size={16} />
                âœ¨ AI Scan (BÃ¬a sÃ¡ch)
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-1.5">
                Chá»¥p khung hÃ¬nh hiá»‡n táº¡i vÃ  dÃ¹ng AI Ä‘á»ƒ nháº­n diá»‡n tÃªn sÃ¡ch
              </p>
            </div>
          )}
        </div>

        {/* â”€â”€ Divider â”€â”€ */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs font-semibold text-gray-400 tracking-widest">HOáº¶C</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* â”€â”€ Nháº­p thá»§ cÃ´ng â”€â”€ */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <KeyboardIcon size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Nháº­p mÃ£ thá»§ cÃ´ng</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="Nháº­p mÃ£ ISBN / MÃ£ váº¡ch..."
              disabled={isLoading}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-300 disabled:opacity-50"
            />
            <button
              onClick={handleManualSubmit}
              disabled={!manualBarcode.trim() || isLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0 flex items-center gap-1.5"
            >
              {loadingState === LOADING_STATE.BARCODE ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Äang tra cá»©u...
                </>
              ) : (
                'XÃ¡c nháº­n'
              )}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-400 text-right">
            AI:{' '}
            <span className="font-mono text-violet-400">{AI_API_BASE}</span>
          </p>
        </div>

        {/* â”€â”€ Footer â”€â”€ */}
        <div className="px-5 py-3 bg-slate-50 border-t border-gray-100 text-center">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40"
          >
            Huá»· vÃ  Ä‘Ã³ng
          </button>
        </div>
      </div>
    </div>
  );
}
