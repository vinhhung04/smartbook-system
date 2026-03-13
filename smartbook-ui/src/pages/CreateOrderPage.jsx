// src/pages/CreateOrderPage.jsx
// Form tạo phiếu nhập kho — 2 bước — tích hợp quét mã vạch

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Barcode, Trash2, ArrowRight, ArrowLeft, Send, BookOpen } from 'lucide-react';
import ScannerModal from '../components/ScannerModal';

// =====================  MOCK: tra ISBN → thông tin sách  =====================
const ISBN_DB = {
  '9786049228438': { title: 'Đắc Nhân Tâm',             author: 'Dale Carnegie',    price: 89_000 },
  '9786041062146': { title: 'Nhà Giả Kim',               author: 'Paulo Coelho',     price: 79_000 },
  '9786041113015': { title: 'Sapiens',                   author: 'Yuval N. Harari',  price: 199_000 },
  '9780735211292': { title: 'Atomic Habits',             author: 'James Clear',      price: 149_000 },
  '9786041177277': { title: 'Tư Duy Nhanh Và Chậm',     author: 'Daniel Kahneman',  price: 169_000 },
};

function lookupISBN(isbn) {
  return (
    ISBN_DB[isbn] ?? {
      title:  `Sách (${isbn})`,
      author: 'Không rõ',
      price:  0,
    }
  );
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

// =====================  STEP INDICATOR  =====================
function StepBar({ step }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {[
        { num: 1, label: 'Thông tin' },
        { num: 2, label: 'Thêm sách' },
      ].map(({ num, label }, i) => (
        <div key={num} className="flex items-center gap-2">
          {i > 0 && <div className={`h-px w-8 ${step > 1 ? 'bg-indigo-400' : 'bg-gray-200'}`} />}
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step >= num ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {num}
            </div>
            <span className={`text-sm font-medium ${step >= num ? 'text-indigo-600' : 'text-gray-400'}`}>
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================  MAIN PAGE  =====================
export default function CreateOrderPage() {
  const navigate = useNavigate();

  // --- Bước & Form ---
  const [step, setStep]             = useState(1);
  const [supplier, setSupplier]     = useState('');
  const [note, setNote]             = useState('');

  // --- Danh sách sách trong phiếu ---
  const [books, setBooks]           = useState([]);

  // --- Scanner ---
  const [scannerOpen, setScannerOpen] = useState(false);

<<<<<<< HEAD
  // Xử lý khi quét thành công — nhận object từ ScannerModal (đã tra API)
  const handleScanSuccess = (data) => {
    // data = { isbn, title, author, coverImage, price } do ScannerModal trả về
    const isbn   = data.isbn   ?? '';
    const title  = data.title  ?? `Sách (${isbn})`;
    const author = data.author ?? 'Không rõ';
    const price  = Number(data.price) || 0;

    setBooks((prev) => {
      // Nếu ISBN đã có → tăng số lượng
      const existing = prev.findIndex((b) => b.isbn === isbn);
=======
  // Xử lý khi quét thành công
  const handleScanSuccess = (barcode) => {
    const info = lookupISBN(barcode);
    setBooks((prev) => {
      // Nếu ISBN đã có → tăng số lượng
      const existing = prev.findIndex((b) => b.isbn === barcode);
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
      if (existing !== -1) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: next[existing].qty + 1 };
        return next;
      }
<<<<<<< HEAD
      return [...prev, { isbn, title, author, price, qty: 1 }];
=======
      return [...prev, { isbn: barcode, ...info, qty: 1 }];
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
    });
  };

  const removeBook = (isbn) => setBooks((prev) => prev.filter((b) => b.isbn !== isbn));

  const updateQty = (isbn, value) => {
    const qty = Math.max(1, Number(value));
    setBooks((prev) => prev.map((b) => (b.isbn === isbn ? { ...b, qty } : b)));
  };

  const totalAmount = books.reduce((sum, b) => sum + b.price * b.qty, 0);

  const handleSubmit = () => {
    alert('Phiếu nhập đã được gửi yêu cầu phê duyệt! (mock)');
    navigate('/orders');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/orders" className="hover:text-indigo-600 transition-colors">Phiếu nhập kho</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Tạo mới</span>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <h1 className="text-xl font-bold text-gray-800 mb-1">Tạo phiếu nhập mới</h1>
        <p className="text-sm text-gray-500 mb-6">Điền thông tin và chọn sách cần nhập.</p>

        <StepBar step={step} />

        {/* ======== BƯỚC 1: Thông tin cơ bản ======== */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Nhà cung cấp <span className="text-red-500">*</span>
              </label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Chọn nhà cung cấp --</option>
                <option>NXB Tổng hợp TP.HCM</option>
                <option>Công ty Fahasa</option>
                <option>NXB Kim Đồng</option>
                <option>Đinh Tị Books</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                Ghi chú
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú thêm cho phiếu nhập (tuỳ chọn)..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!supplier}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                Tiếp tục
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ======== BƯỚC 2: Thêm sách ======== */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Thông tin đã chọn ở bước 1 */}
            <div className="bg-slate-50 rounded-lg px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Nhà cung cấp</p>
                <p className="text-sm font-semibold text-gray-700">{supplier}</p>
              </div>
              {note && (
                <div className="text-right max-w-[200px]">
                  <p className="text-xs text-gray-400">Ghi chú</p>
                  <p className="text-xs text-gray-600 truncate">{note}</p>
                </div>
              )}
            </div>

            {/* Nút quét + danh sách sách */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                Danh sách sách ({books.length} đầu sách)
              </h3>
              <button
                onClick={() => setScannerOpen(true)}
                className="flex items-center gap-2 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <Barcode size={16} />
                Quét mã vạch để thêm
              </button>
            </div>

            {/* Bảng sách */}
            {books.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-xl py-10 flex flex-col items-center text-gray-400 gap-2">
                <BookOpen size={32} />
                <p className="text-sm">Chưa có sách nào. Quét mã vạch để thêm.</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                      <th className="px-4 py-2.5 text-left font-semibold">Sách / ISBN</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Số lượng</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Đơn giá</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Thành tiền</th>
                      <th className="px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {books.map((book) => (
                      <tr key={book.isbn} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{book.title}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{book.isbn}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="number"
                            min="1"
                            value={book.qty}
                            onChange={(e) => updateQty(book.isbn, e.target.value)}
                            className="w-16 text-center border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatVND(book.price)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800">
                          {formatVND(book.price * book.qty)}
                        </td>
                        <td className="px-2 py-3">
                          <button
                            onClick={() => removeBook(book.isbn)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t border-gray-200">
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-700 text-right">
                        Tổng cộng:
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-700 text-base">
                        {formatVND(totalAmount)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Điều hướng */}
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 border border-gray-200 text-gray-600 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
              >
                <ArrowLeft size={16} />
                Quay lại
              </button>
              <button
                onClick={handleSubmit}
                disabled={books.length === 0}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <Send size={16} />
                Gửi yêu cầu phê duyệt
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scanner Modal */}
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />
    </div>
  );
}
