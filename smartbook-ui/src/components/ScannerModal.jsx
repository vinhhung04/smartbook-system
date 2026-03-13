// src/components/ScannerModal.jsx
// Modal quét mã vạch / QR Code dùng html5-qrcode
<<<<<<< HEAD
// + Nhận diện bìa sách bằng AI (Ollama/LLaVA)

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, KeyboardIcon, Loader2, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';

const SCANNER_ID = 'reader';
const API_BASE     = 'http://localhost:3001';
const AI_API_BASE  = 'http://localhost:8000';

// ─── Trạng thái loading ─────────────────────────────────────────────────────
const LOADING_STATE = {
  NONE:    'none',
  BARCODE: 'barcode',   // đang tra cứu barcode
  AI:      'ai',        // đang gọi AI nhận diện bìa
};

export default function ScannerModal({ isOpen, onClose, onScanSuccess }) {
  const scannerRef   = useRef(null);
  const [manualBarcode,    setManualBarcode]    = useState('');
  const [loadingState,     setLoadingState]     = useState(LOADING_STATE.NONE);
  const [cameraError,      setCameraError]      = useState(null);
  const [cameras,          setCameras]          = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [aiError,          setAiError]          = useState(null);

  const isLoading = loadingState !== LOADING_STATE.NONE;

  // ─── Dừng camera sạch sẽ ──────────────────────────────────────────────────
  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
  }, []);

  // ─── Tra cứu sách qua barcode ─────────────────────────────────────────────
  const handleScanSuccess = useCallback(async (code) => {
    if (!code || loadingState !== LOADING_STATE.NONE) return;
    setLoadingState(LOADING_STATE.BARCODE);
    setAiError(null);
    try {
      const res = await fetch(`${API_BASE}/api/lookup/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('Barcode API Response:', data);

      const bookData = {
        isbn:       data.isbn        ?? code,
        title:      data.title       ?? '(Không có tiêu đề)',
        author:     data.author      ?? '(Không rõ tác giả)',
        coverImage: data.coverImage  ?? data.cover_image ?? '',
        price:      data.price       ?? 0,
      };

      if (data.title) alert(`Đã tìm thấy: ${data.title}`);

      await stopCamera();
      onScanSuccess(bookData);
      onClose();
    } catch (err) {
      console.error('Lookup error:', err);
      alert('Không tìm thấy sách!');
    } finally {
      setLoadingState(LOADING_STATE.NONE);
    }
  }, [loadingState, stopCamera, onScanSuccess, onClose]);

  // ─── Chụp frame từ <video> của html5-qrcode ───────────────────────────────
  const captureFrameAsBlob = useCallback(() => {
    return new Promise((resolve, reject) => {
      const container = document.getElementById(SCANNER_ID);
      if (!container) return reject(new Error('Không tìm thấy viewport camera.'));

      const video = container.querySelector('video');
      if (!video || video.readyState < 2) {
        return reject(new Error('Camera chưa sẵn sàng. Hãy đợi vài giây rồi thử lại.'));
      }

      const canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Không thể chuyển đổi khung hình thành ảnh.'));
        },
        'image/jpeg',
        0.92,
      );
    });
  }, []);

  // ─── Gửi ảnh lên AI service để nhận diện bìa sách ────────────────────────
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
        throw new Error(`AI service lỗi (${res.status})${errText ? ': ' + errText : ''}`);
      }

      const data = await res.json();
      console.log('AI Recognition Response:', data);

      const bookData = {
        isbn:       data.isbn        ?? '',
        title:      data.title       ?? '(Không có tiêu đề)',
        author:     data.author      ?? '(Không rõ tác giả)',
        coverImage: data.coverImage  ?? data.cover_image ?? '',
        price:      data.price       ?? 0,
      };

      await stopCamera();
      onScanSuccess(bookData);
      onClose();
    } catch (err) {
      console.error('AI scan error:', err);
      setAiError(err.message || 'AI nhận diện thất bại. Hãy thử lại.');
    } finally {
      setLoadingState(LOADING_STATE.NONE);
    }
  }, [isLoading, captureFrameAsBlob, stopCamera, onScanSuccess, onClose]);

  // ─── Khởi động camera theo deviceId ──────────────────────────────────────
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
        ? 'Trình duyệt bị chặn quyền Camera. Hãy cho phép trong Settings rồi thử lại.'
        : 'Không mở được Camera này. Hãy thử chọn camera khác.';
      setCameraError(msg);
    }
  }, [stopCamera, handleScanSuccess]);

  // ─── Đổi camera ───────────────────────────────────────────────────────────
  const handleCameraChange = async (e) => {
    const id = e.target.value;
    setSelectedCameraId(id);
    await startCameraById(id);
  };

  // ─── Nhập mã thủ công ─────────────────────────────────────────────────────
=======

import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { X, Camera, KeyboardIcon } from 'lucide-react';

const SCANNER_ID = 'html5qr-reader';

export default function ScannerModal({ isOpen, onClose, onScanSuccess }) {
  const scannerRef = useRef(null);
  const [manualBarcode, setManualBarcode] = useState('');

  // Hàm xử lý nhập thủ công
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
  const handleManualSubmit = () => {
    const trimmed = manualBarcode.trim();
    if (!trimmed) return;
    setManualBarcode('');
<<<<<<< HEAD
    handleScanSuccess(trimmed);
  };

  // ─── Khởi tạo khi modal mở ────────────────────────────────────────────────
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
          setCameraError('Không tìm thấy Camera nào. Vui lòng nhập mã thủ công.');
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
            ? 'Trình duyệt bị chặn quyền Camera. Hãy cho phép trong Settings rồi thử lại.'
            : 'Không mở được Camera. Vui lòng nhập mã thủ công.';
          setCameraError(msg);
        }
      }
    };

    const timer = setTimeout(initCamera, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Clean-up: dừng camera khi unmount / đóng modal
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
=======
    onScanSuccess(trimmed);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;

    // Delay nhỏ để DOM render xong trước khi gắn scanner
    const timer = setTimeout(() => {
      if (scannerRef.current) return; // đã khởi tạo rồi thì bỏ qua

      const scanner = new Html5QrcodeScanner(
        SCANNER_ID,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
          aspectRatio: 1.0,
        },
        /* verbose= */ false
      );

      scanner.render(
        (decodedText) => {
          // Quét thành công → trả kết quả về cha và đóng modal
          onScanSuccess(decodedText);
          scanner.clear().catch(() => {});
          scannerRef.current = null;
          onClose();
        },
        (errorMessage) => {
          // Lỗi quét (bỏ qua, không cần hiện ra UI)
          void errorMessage;
        }
      );

      scannerRef.current = scanner;
    }, 100);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
        scannerRef.current = null;
      }
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

<<<<<<< HEAD
  // ─── Đóng modal ───────────────────────────────────────────────────────────
  const handleClose = async () => {
    await stopCamera();
    setManualBarcode('');
    setLoadingState(LOADING_STATE.NONE);
    setCameraError(null);
    setAiError(null);
    setCameras([]);
    setSelectedCameraId(null);
=======
  const handleClose = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(() => {});
      scannerRef.current = null;
    }
    setManualBarcode('');
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
    onClose();
  };

  if (!isOpen) return null;

  return (
<<<<<<< HEAD
=======
    /* Overlay */
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Nền mờ */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
<<<<<<< HEAD
        onClick={!isLoading ? handleClose : undefined}
=======
        onClick={handleClose}
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
      />

      {/* Card modal */}
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
<<<<<<< HEAD

        {/* ── Header ── */}
=======
        {/* Header */}
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-gray-800">Quét mã vạch / QR Code</h2>
          </div>
          <button
            onClick={handleClose}
<<<<<<< HEAD
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
=======
            className="text-gray-400 hover:text-gray-600 transition-colors"
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
          >
            <X size={20} />
          </button>
        </div>

<<<<<<< HEAD
        {/* ── Loading overlay ── */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/85 backdrop-blur-sm rounded-2xl gap-4 px-6">
            {/* Vòng xoay đa lớp cho AI loading */}
            <div className="relative flex items-center justify-center">
              <Loader2
                size={40}
                className={`animate-spin ${loadingState === LOADING_STATE.AI ? 'text-violet-500' : 'text-indigo-600'}`}
              />
              {loadingState === LOADING_STATE.AI && (
                <span className="absolute text-lg">✨</span>
              )}
            </div>
            <div className="text-center">
              {loadingState === LOADING_STATE.AI ? (
                <>
                  <p className="text-sm font-semibold text-violet-700">
                    AI đang nhìn bìa sách, chờ xíu nhé...
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Quá trình có thể mất 10 – 20 giây
                  </p>
                </>
              ) : (
                <p className="text-sm font-medium text-gray-700">Đang tra cứu...</p>
              )}
            </div>
          </div>
        )}

        {/* ── Camera viewport ── */}
        <div className="px-4 pt-4">
          {/* Dropdown chọn camera */}
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
                title="Thử lại"
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
                  <p className="text-xs text-red-500 mt-1">Hãy thử chọn camera khác từ danh sách phía trên.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500 mb-3 text-center">
              Hướng camera vào mã vạch của sách. Hệ thống sẽ tự động nhận diện.
            </p>
          )}

          {/* html5-qrcode render vào đây — giữ div dù có lỗi */}
          <div id={SCANNER_ID} className={`w-full ${cameraError ? 'hidden' : ''}`} />

          {/* ── Nút AI Scan ── */}
          {!cameraError && (
            <div className="mt-3 mb-1">
              {/* Thông báo lỗi AI (nếu có) */}
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
                ✨ AI Scan (Bìa sách)
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-1.5">
                Chụp khung hình hiện tại và dùng AI để nhận diện tên sách
              </p>
            </div>
          )}
        </div>

        {/* ── Divider ── */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs font-semibold text-gray-400 tracking-widest">HOẶC</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* ── Nhập thủ công ── */}
=======
        {/* Camera viewport */}
        <div className="px-4 pt-4">
          <p className="text-xs text-gray-500 mb-3 text-center">
            Hướng camera vào mã vạch của sách. Hệ thống sẽ tự động nhận diện.
          </p>
          {/* html5-qrcode gắn vào đây */}
          <div id={SCANNER_ID} className="w-full" />
        </div>

        {/* Divider HOẶC */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs font-semibold text-gray-400 tracking-widest">HOỎC</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Nhập thủ công */}
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <KeyboardIcon size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Nhập mã thủ công</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              placeholder="Nhập mã ISBN / Mã vạch..."
<<<<<<< HEAD
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
                  Đang tra cứu...
                </>
              ) : (
                'Xác nhận'
              )}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-400 text-right">
            Backend:{' '}
            <span className="font-mono text-indigo-400">{API_BASE}</span>
            {' · '}
            AI:{' '}
            <span className="font-mono text-violet-400">{AI_API_BASE}</span>
          </p>
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 bg-slate-50 border-t border-gray-100 text-center">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-40"
=======
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-300"
            />
            <button
              onClick={handleManualSubmit}
              disabled={!manualBarcode.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
            >
              Xác nhận
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-gray-100 text-center">
          <button
            onClick={handleClose}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
          >
            Huỷ và đóng
          </button>
        </div>
      </div>
    </div>
  );
}
