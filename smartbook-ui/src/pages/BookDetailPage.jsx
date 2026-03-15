// src/pages/BookDetailPage.jsx
// Trang Chi tiáº¿t sÃ¡ch & Biáº¿n thá»ƒ (Variants)
// Æ¯u tiÃªn hiá»ƒn thá»‹ dá»¯ liá»‡u tá»« location.state.scannedBook (Google Books / barcode lookup)
// náº¿u khÃ´ng cÃ³ má»›i tra mock DB.

import { useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, BookOpen, Save, Info, Loader2 } from 'lucide-react';

const COVER_FALLBACK = 'https://placehold.co/400x600?text=No+Cover';

// =====================  MOCK DATA  =====================
const MOCK_BOOKS = {
  'BK001': {
    id: 'BK001',
    title: 'Äáº¯c NhÃ¢n TÃ¢m',
    author: 'Dale Carnegie',
    isbn: '9786049228438',
    genre: 'Ká»¹ nÄƒng sá»‘ng / Self-help',
    publisher: 'NXB Tá»•ng há»£p TP.HCM',
    year: '2023',
    price: 89000,
    coverImage: null,
    description:
      'Cuá»‘n sÃ¡ch kinh Ä‘iá»ƒn vá» nghá»‡ thuáº­t giao tiáº¿p vÃ  á»©ng xá»­ cá»§a Dale Carnegie, Ä‘Ã£ Ä‘Æ°á»£c dá»‹ch ra hÆ¡n 40 thá»© tiáº¿ng vÃ  bÃ¡n hÆ¡n 30 triá»‡u báº£n trÃªn toÃ n tháº¿ giá»›i.',
    variants: [
      {
        sku: 'BK001-HRD-NEW',
        format: 'BÃ¬a cá»©ng',
        condition: 'Má»›i',
        location: 'Ká»‡ A-1',
        quantity: 35,
      },
      {
        sku: 'BK001-SFT-NEW',
        format: 'BÃ¬a má»m',
        condition: 'Má»›i',
        location: 'Ká»‡ A-2',
        quantity: 10,
      },
      {
        sku: 'BK001-SFT-OLD',
        format: 'BÃ¬a má»m',
        condition: 'CÅ©',
        location: 'Ká»‡ D-3',
        quantity: 4,
      },
    ],
  },
};

// Fallback náº¿u id khÃ´ng tá»“n táº¡i trong mock
const FALLBACK_BOOK = {
  id: '???',
  title: 'KhÃ´ng tÃ¬m tháº¥y sÃ¡ch',
  author: 'â€”',
  isbn: 'â€”',
  genre: 'â€”',
  publisher: 'â€”',
  year: 'â€”',
  price: 0,
  coverImage: null,
  description: 'KhÃ´ng cÃ³ dá»¯ liá»‡u cho sÃ¡ch nÃ y.',
  variants: [],
};

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
}

// Map mÃ£ ngÃ´n ngá»¯ ISO 639-1 â†’ tÃªn hiá»ƒn thá»‹
const LANG_NAMES = {
  vi: 'Tiáº¿ng Viá»‡t', en: 'Tiáº¿ng Anh',   fr: 'Tiáº¿ng PhÃ¡p',
  de: 'Tiáº¿ng Äá»©c',   ja: 'Tiáº¿ng Nháº­t',  ko: 'Tiáº¿ng HÃ n',
  zh: 'Tiáº¿ng Trung',  es: 'Tiáº¿ng TÃ¢y Ban Nha',
};
const langName = (code) => LANG_NAMES[code?.toLowerCase()] ?? code ?? 'ChÆ°a cáº­p nháº­t';

// =====================  HELPER BADGES  =====================
const CONDITION_CONFIG = {
  'Má»›i':      'bg-green-100 text-green-700',
  'CÅ©':       'bg-yellow-100 text-yellow-700',
  'HÆ° há»ng':  'bg-red-100 text-red-700',
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
  const location = useLocation();
  const [saved, setSaved] = useState(false);

  // Dá»¯ liá»‡u tá»« quÃ©t mÃ£ váº¡ch (Google Books / API Backend lookup)
  const scannedBook = location.state?.scannedBook ?? null;
  const isNewBook = !!scannedBook; // true = chÆ°a cÃ³ trong DB

  // Æ¯u tiÃªn: scannedBook > mock DB > fallback
  const book = isNewBook
    ? {
        id:            scannedBook.isbn          ?? id,
        title:         scannedBook.title         ?? FALLBACK_BOOK.title,
        author:        scannedBook.author        ?? 'ChÆ°a cáº­p nháº­t',
        isbn:          scannedBook.isbn          ?? 'â€”',
        // trÆ°á»ng má»›i tá»« API Backend cáº­p nháº­t
        publisher:     scannedBook.publisher     || 'ChÆ°a cáº­p nháº­t',
        year:          scannedBook.publishedDate || scannedBook.year || 'ChÆ°a cáº­p nháº­t',
        pageCount:     scannedBook.pageCount     ?? null,
        categories:    scannedBook.categories    || 'ChÆ°a cáº­p nháº­t',
        language:      scannedBook.language      || 'ChÆ°a cáº­p nháº­t',
        genre:         scannedBook.categories    || scannedBook.genre || 'ChÆ°a cáº­p nháº­t',
        price:         Number(scannedBook.price) || 0,
        description:   scannedBook.description   || '',
        coverImage:    scannedBook.coverImage    || null,
        source:        scannedBook.source        || null,
        variants:      [],
      }
    : (MOCK_BOOKS[id] ?? FALLBACK_BOOK);

  // Giáº£ láº­p lÆ°u vÃ o kho (thá»±c táº¿ sáº½ gá»i POST API)
  const handleSaveToInventory = () => {
    console.log('LÆ°u sÃ¡ch vÃ o kho:', book);
    setSaved(true);
    // TODO: gá»i POST /api/books vá»›i dá»¯ liá»‡u book
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Breadcrumb / Back */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/inventory" className="flex items-center gap-1 hover:text-indigo-600 transition-colors">
          <ArrowLeft size={15} />
          Kho sÃ¡ch
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium truncate">{book.title}</span>
      </div>

      {/* Banner: sÃ¡ch má»›i tá»« quÃ©t mÃ£ â€” chÆ°a lÆ°u vÃ o DB */}
      {isNewBook && !saved && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Info size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">SÃ¡ch chÆ°a cÃ³ trong há»‡ thá»‘ng</p>
            <p className="text-xs text-amber-700 mt-0.5">
              ThÃ´ng tin Ä‘Æ°á»£c láº¥y tá»« Google Books qua mÃ£ váº¡ch. Nháº¥n{' '}
              <strong>LÆ°u vÃ o kho</strong> Ä‘á»ƒ thÃªm sÃ¡ch nÃ y vÃ o cÆ¡ sá»Ÿ dá»¯ liá»‡u.
            </p>
          </div>
        </div>
      )}

      {/* Banner: Ä‘Ã£ lÆ°u thÃ nh cÃ´ng */}
      {saved && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <Save size={18} className="text-green-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-800">
            ÄÃ£ lÆ°u <strong>{book.title}</strong> vÃ o kho thÃ nh cÃ´ng!
          </p>
        </div>
      )}

      {/* ---- PHáº¦N TRÃŠN: ThÃ´ng tin chung ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <div className="flex gap-6">
          {/* áº¢nh bÃ¬a */}
          <div className="w-36 h-52 flex-shrink-0 bg-indigo-50 rounded-lg border border-indigo-100 flex items-center justify-center overflow-hidden shadow-sm">
            {book.coverImage ? (
              <img
                src={book.coverImage}
                alt={book.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.onerror = null; // ngÄƒn vÃ²ng láº·p
                  e.currentTarget.src = COVER_FALLBACK;
                }}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-indigo-200">
                <BookOpen size={36} />
                <span className="text-[10px] text-indigo-300">No Cover</span>
              </div>
            )}
          </div>

          {/* ThÃ´ng tin */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">{book.title}</h1>
                <p className="text-gray-500 mt-1">{book.author}</p>
              </div>
              {/* NÃºt hÃ nh Ä‘á»™ng: LÆ°u vÃ o kho (sÃ¡ch má»›i) | Chá»‰nh sá»­a (sÃ¡ch Ä‘Ã£ cÃ³) */}
              {isNewBook ? (
                <button
                  onClick={handleSaveToInventory}
                  disabled={saved}
                  className="flex items-center gap-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-green-300 border border-transparent rounded-lg px-4 py-2 transition-colors flex-shrink-0"
                >
                  <Save size={14} />
                  {saved ? 'ÄÃ£ lÆ°u' : 'LÆ°u vÃ o kho'}
                </button>
              ) : (
                <button className="flex items-center gap-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg px-4 py-2 hover:bg-indigo-50 transition-colors flex-shrink-0">
                  <Pencil size={14} />
                  Chá»‰nh sá»­a
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4 mt-5 text-sm">
              {/* GiÃ¡ bÃ¬a â€” ná»•i báº­t hÆ¡n */}
              <div className="col-span-2 sm:col-span-1 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <p className="text-xs text-green-600 uppercase tracking-wide font-semibold">GiÃ¡ bÃ¬a</p>
                <p className="text-green-700 font-bold text-base mt-0.5">
                  {book.price ? formatVND(book.price) : 'ChÆ°a cáº­p nháº­t'}
                </p>
              </div>

              {[
                { label: 'ISBN',          value: book.isbn },
                { label: 'NhÃ  xuáº¥t báº£n',  value: book.publisher  || 'ChÆ°a cáº­p nháº­t' },
                { label: 'NÄƒm xuáº¥t báº£n',  value: book.year       || 'ChÆ°a cáº­p nháº­t' },
                { label: 'Thá»ƒ loáº¡i',      value: book.categories || book.genre || 'ChÆ°a cáº­p nháº­t' },
                { label: 'Sá»‘ trang',      value: book.pageCount  ? `${book.pageCount} trang` : 'ChÆ°a cáº­p nháº­t' },
                { label: 'NgÃ´n ngá»¯',      value: langName(book.language) },
                { label: 'MÃ£ sÃ¡ch',       value: book.id },
              ].map(({ label, value }) => {
                const isMissing = value === 'ChÆ°a cáº­p nháº­t';
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

            {/* Nguá»“n dá»¯ liá»‡u */}
            {book.source && (
              <div className="mt-3 flex items-center gap-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  book.source.includes('Live') ? 'bg-green-400' : 'bg-orange-400'
                }`} />
                <span className="text-[11px] text-gray-400">{book.source}</span>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">MÃ´ táº£</p>
              {/* max-h-40 + overflow-y-auto Ä‘á»ƒ cuá»™n náº¿u mÃ´ táº£ quÃ¡ dÃ i */}
              <div className="max-h-40 overflow-y-auto pr-1">
                {book.description ? (
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
                    {book.description}
                  </p>
                ) : (
                  <p className="text-xs text-gray-300 italic">ChÆ°a cÃ³ mÃ´ táº£.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- PHáº¦N DÆ¯á»šI: Danh sÃ¡ch Biáº¿n thá»ƒ ---- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Danh sÃ¡ch biáº¿n thá»ƒ ({book.variants.length} SKU)
          </h2>
          <button
            disabled={isNewBook && !saved}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
            title={isNewBook && !saved ? 'LÆ°u sÃ¡ch vÃ o kho trÆ°á»›c khi thÃªm biáº¿n thá»ƒ' : ''}
          >
            <Plus size={14} />
            ThÃªm biáº¿n thá»ƒ
          </button>
        </div>

        {book.variants.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <p className="text-gray-400 text-sm">ChÆ°a cÃ³ biáº¿n thá»ƒ nÃ o.</p>
            {isNewBook && !saved && (
              <p className="text-amber-600 text-xs font-medium">
                LÆ°u sÃ¡ch vÃ o kho trÆ°á»›c Ä‘á»ƒ báº¯t Ä‘áº§u quáº£n lÃ½ biáº¿n thá»ƒ.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-5 py-3 font-semibold">MÃ£ SKU</th>
                  <th className="px-5 py-3 font-semibold">Äá»‹nh dáº¡ng</th>
                  <th className="px-5 py-3 font-semibold">TÃ¬nh tráº¡ng</th>
                  <th className="px-5 py-3 font-semibold">Vá»‹ trÃ­ lÆ°u trá»¯</th>
                  <th className="px-5 py-3 font-semibold text-center">Sá»‘ lÆ°á»£ng tá»“n</th>
                  <th className="px-5 py-3 font-semibold">HÃ nh Ä‘á»™ng</th>
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
                        <button className="text-xs text-indigo-600 hover:underline font-medium">Sá»­a</button>
                        <button className="text-xs text-red-500 hover:underline font-medium">XoÃ¡</button>
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
