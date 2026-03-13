// src/pages/BookDetailPage.jsx
<<<<<<< HEAD
// Trang Chi tiết sách & Biến thể (Variants)
// Ưu tiên hiển thị dữ liệu từ location.state.scannedBook (Google Books / barcode lookup)
// nếu không có mới tra mock DB.

import { useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, BookOpen, Save, Info, Loader2 } from 'lucide-react';

const COVER_FALLBACK = 'https://placehold.co/400x600?text=No+Cover';
=======
// Trang Chi tiết sách & Biến thể (Variants) — nhận :id từ URL

import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, BookOpen } from 'lucide-react';
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4

// =====================  MOCK DATA  =====================
const MOCK_BOOKS = {
  'BK001': {
    id: 'BK001',
    title: 'Đắc Nhân Tâm',
    author: 'Dale Carnegie',
    isbn: '9786049228438',
    genre: 'Kỹ năng sống / Self-help',
    publisher: 'NXB Tổng hợp TP.HCM',
    year: '2023',
<<<<<<< HEAD
    price: 89000,
    coverImage: null,
=======
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
    description:
      'Cuốn sách kinh điển về nghệ thuật giao tiếp và ứng xử của Dale Carnegie, đã được dịch ra hơn 40 thứ tiếng và bán hơn 30 triệu bản trên toàn thế giới.',
    variants: [
      {
        sku: 'BK001-HRD-NEW',
        format: 'Bìa cứng',
        condition: 'Mới',
        location: 'Kệ A-1',
        quantity: 35,
      },
      {
        sku: 'BK001-SFT-NEW',
        format: 'Bìa mềm',
        condition: 'Mới',
        location: 'Kệ A-2',
        quantity: 10,
      },
      {
        sku: 'BK001-SFT-OLD',
        format: 'Bìa mềm',
        condition: 'Cũ',
        location: 'Kệ D-3',
        quantity: 4,
      },
    ],
  },
};

// Fallback nếu id không tồn tại trong mock
const FALLBACK_BOOK = {
  id: '???',
  title: 'Không tìm thấy sách',
  author: '—',
  isbn: '—',
  genre: '—',
  publisher: '—',
  year: '—',
<<<<<<< HEAD
  price: 0,
  coverImage: null,
=======
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
  description: 'Không có dữ liệu cho sách này.',
  variants: [],
};

<<<<<<< HEAD
function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

// Map mã ngôn ngữ ISO 639-1 → tên hiển thị
const LANG_NAMES = {
  vi: 'Tiếng Việt', en: 'Tiếng Anh',   fr: 'Tiếng Pháp',
  de: 'Tiếng Đức',   ja: 'Tiếng Nhật',  ko: 'Tiếng Hàn',
  zh: 'Tiếng Trung',  es: 'Tiếng Tây Ban Nha',
};
const langName = (code) => LANG_NAMES[code?.toLowerCase()] ?? code ?? 'Chưa cập nhật';

=======
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
// =====================  HELPER BADGES  =====================
const CONDITION_CONFIG = {
  'Mới':      'bg-green-100 text-green-700',
  'Cũ':       'bg-yellow-100 text-yellow-700',
  'Hư hỏng':  'bg-red-100 text-red-700',
};

function ConditionBadge({ condition }) {
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${CONDITION_CONFIG[condition] ?? 'bg-gray-100 text-gray-600'}`}>
      {condition}
    </span>
  );
}

// =====================  MAIN PAGE  =====================
export default function BookDetailPage() {
  const { id } = useParams();
<<<<<<< HEAD
  const location = useLocation();
  const [saved, setSaved] = useState(false);

  // Dữ liệu từ quét mã vạch (Google Books / API Backend lookup)
  const scannedBook = location.state?.scannedBook ?? null;
  const isNewBook = !!scannedBook; // true = chưa có trong DB

  // Ưu tiên: scannedBook > mock DB > fallback
  const book = isNewBook
    ? {
        id:            scannedBook.isbn          ?? id,
        title:         scannedBook.title         ?? FALLBACK_BOOK.title,
        author:        scannedBook.author        ?? 'Chưa cập nhật',
        isbn:          scannedBook.isbn          ?? '—',
        // trường mới từ API Backend cập nhật
        publisher:     scannedBook.publisher     || 'Chưa cập nhật',
        year:          scannedBook.publishedDate || scannedBook.year || 'Chưa cập nhật',
        pageCount:     scannedBook.pageCount     ?? null,
        categories:    scannedBook.categories    || 'Chưa cập nhật',
        language:      scannedBook.language      || 'Chưa cập nhật',
        genre:         scannedBook.categories    || scannedBook.genre || 'Chưa cập nhật',
        price:         Number(scannedBook.price) || 0,
        description:   scannedBook.description   || '',
        coverImage:    scannedBook.coverImage    || null,
        source:        scannedBook.source        || null,
        variants:      [],
      }
    : (MOCK_BOOKS[id] ?? FALLBACK_BOOK);

  // Giả lập lưu vào kho (thực tế sẽ gọi POST API)
  const handleSaveToInventory = () => {
    console.log('Lưu sách vào kho:', book);
    setSaved(true);
    // TODO: gọi POST /api/books với dữ liệu book
  };
=======
  const book = MOCK_BOOKS[id] ?? FALLBACK_BOOK;
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Breadcrumb / Back */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/inventory" className="flex items-center gap-1 hover:text-indigo-600 transition-colors">
          <ArrowLeft size={15} />
          Kho sách
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium truncate">{book.title}</span>
      </div>

<<<<<<< HEAD
      {/* Banner: sách mới từ quét mã — chưa lưu vào DB */}
      {isNewBook && !saved && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Info size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">Sách chưa có trong hệ thống</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Thông tin được lấy từ Google Books qua mã vạch. Nhấn{' '}
              <strong>Lưu vào kho</strong> để thêm sách này vào cơ sở dữ liệu.
            </p>
          </div>
        </div>
      )}

      {/* Banner: đã lưu thành công */}
      {saved && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <Save size={18} className="text-green-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-800">
            Đã lưu <strong>{book.title}</strong> vào kho thành công!
          </p>
        </div>
      )}

      {/* ---- PHẦN TRÊN: Thông tin chung ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <div className="flex gap-6">
          {/* Ảnh bìa */}
          <div className="w-36 h-52 flex-shrink-0 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-center overflow-hidden shadow-sm">
            {book.coverImage ? (
              <img
                src={book.coverImage}
                alt={book.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.onerror = null; // ngăn vòng lặp
                  e.currentTarget.src = COVER_FALLBACK;
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-indigo-200">
                <BookOpen size={36} />
                <span className="text-[10px] text-indigo-300">No Cover</span>
              </div>
            )}
=======
      {/* ---- PHẦN TRÊN: Thông tin chung ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <div className="flex gap-6">
          {/* Ảnh bìa placeholder */}
          <div className="w-32 h-44 flex-shrink-0 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-center">
            <BookOpen size={36} className="text-indigo-300" />
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
          </div>

          {/* Thông tin */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">{book.title}</h1>
                <p className="text-gray-500 mt-1">{book.author}</p>
              </div>
<<<<<<< HEAD
              {/* Nút hành động: Lưu vào kho (sách mới) | Chỉnh sửa (sách đã có) */}
              {isNewBook ? (
                <button
                  onClick={handleSaveToInventory}
                  disabled={saved}
                  className="flex items-center gap-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-green-300 border border-transparent rounded-lg px-4 py-2 transition-colors flex-shrink-0"
                >
                  <Save size={14} />
                  {saved ? 'Đã lưu' : 'Lưu vào kho'}
                </button>
              ) : (
                <button className="flex items-center gap-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg px-4 py-2 hover:bg-indigo-50 transition-colors flex-shrink-0">
                  <Pencil size={14} />
                  Chỉnh sửa
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4 mt-5 text-sm">
              {/* Giá bìa — nổi bật hơn */}
              <div className="col-span-2 sm:col-span-1 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <p className="text-xs text-green-600 uppercase tracking-wide font-semibold">Giá bìa</p>
                <p className="text-green-700 font-bold text-base mt-0.5">
                  {book.price ? formatVND(book.price) : 'Chưa cập nhật'}
                </p>
              </div>

              {[
                { label: 'ISBN',          value: book.isbn },
                { label: 'Nhà xuất bản',  value: book.publisher  || 'Chưa cập nhật' },
                { label: 'Năm xuất bản',  value: book.year       || 'Chưa cập nhật' },
                { label: 'Thể loại',      value: book.categories || book.genre || 'Chưa cập nhật' },
                { label: 'Số trang',      value: book.pageCount  ? `${book.pageCount} trang` : 'Chưa cập nhật' },
                { label: 'Ngôn ngữ',      value: langName(book.language) },
                { label: 'Mã sách',       value: book.id },
              ].map(({ label, value }) => {
                const isMissing = value === 'Chưa cập nhật';
                return (
                  <div key={label}>
                    <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
                    <p className={`font-medium mt-0.5 break-words ${
                      isMissing ? 'text-gray-300 italic text-xs' : 'text-gray-700'
                    }`}>{value}</p>
                  </div>
                );
              })}
            </div>

            {/* Nguồn dữ liệu */}
            {book.source && (
              <div className="mt-3 flex items-center gap-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  book.source.includes('Live') ? 'bg-green-400' : 'bg-orange-400'
                }`} />
                <span className="text-[11px] text-gray-400">{book.source}</span>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Mô tả</p>
              {/* max-h-40 + overflow-y-auto để cuộn nếu mô tả quá dài */}
              <div className="max-h-40 overflow-y-auto pr-1">
                {book.description ? (
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                    {book.description}
                  </p>
                ) : (
                  <p className="text-xs text-gray-300 italic">Chưa có mô tả.</p>
                )}
              </div>
=======
              <button className="flex items-center gap-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg px-4 py-2 hover:bg-indigo-50 transition-colors flex-shrink-0">
                <Pencil size={14} />
                Chỉnh sửa
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 mt-5 text-sm">
              {[
                { label: 'ISBN',         value: book.isbn },
                { label: 'Thể loại',     value: book.genre },
                { label: 'Nhà xuất bản', value: book.publisher },
                { label: 'Năm XB',       value: book.year },
                { label: 'Mã sách',      value: book.id },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
                  <p className="text-gray-700 font-medium mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Mô tả</p>
              <p className="text-sm text-gray-600 leading-relaxed">{book.description}</p>
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
            </div>
          </div>
        </div>
      </div>

      {/* ---- PHẦN DƯỚI: Danh sách Biến thể ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Danh sách biến thể ({book.variants.length} SKU)
          </h2>
<<<<<<< HEAD
          <button
            disabled={isNewBook && !saved}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
            title={isNewBook && !saved ? 'Lưu sách vào kho trước khi thêm biến thể' : ''}
          >
=======
          <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors">
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
            <Plus size={14} />
            Thêm biến thể
          </button>
        </div>

        {book.variants.length === 0 ? (
<<<<<<< HEAD
          <div className="py-12 text-center space-y-2">
            <p className="text-gray-400 text-sm">Chưa có biến thể nào.</p>
            {isNewBook && !saved && (
              <p className="text-amber-600 text-xs font-medium">
                Lưu sách vào kho trước để bắt đầu quản lý biến thể.
              </p>
            )}
=======
          <div className="py-12 text-center text-gray-400 text-sm">
            Chưa có biến thể nào. Hãy thêm biến thể đầu tiên.
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-5 py-3 font-semibold">Mã SKU</th>
                  <th className="px-5 py-3 font-semibold">Định dạng</th>
                  <th className="px-5 py-3 font-semibold">Tình trạng</th>
                  <th className="px-5 py-3 font-semibold">Vị trí lưu trữ</th>
                  <th className="px-5 py-3 font-semibold text-center">Số lượng tồn</th>
                  <th className="px-5 py-3 font-semibold">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {book.variants.map((v) => (
                  <tr key={v.sku} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{v.sku}</td>
                    <td className="px-5 py-3.5 text-gray-700 font-medium">{v.format}</td>
                    <td className="px-5 py-3.5">
                      <ConditionBadge condition={v.condition} />
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-1 rounded">
                        {v.location}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center font-bold text-gray-800">{v.quantity}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <button className="text-xs text-indigo-600 hover:underline font-medium">Sửa</button>
                        <button className="text-xs text-red-500 hover:underline font-medium">Xoá</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
