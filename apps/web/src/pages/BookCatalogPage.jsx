import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, BookOpen } from 'lucide-react';

const EMPTY_FORM = {
  title: '',
  isbn: '',
  author: '',
  genre: '',
  publisher: '',
  thumbnail: '',
};

function createMockCover(label, color) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="136" viewBox="0 0 96 136" fill="none">
      <rect width="96" height="136" rx="12" fill="${color}"/>
      <rect x="12" y="16" width="72" height="104" rx="8" fill="rgba(255,255,255,0.16)"/>
      <path d="M31 42.5C31 39.4624 33.4624 37 36.5 37H60.5C63.5376 37 66 39.4624 66 42.5V92.5C66 95.5376 63.5376 98 60.5 98H36.5C33.4624 98 31 95.5376 31 92.5V42.5Z" fill="white" fill-opacity="0.92"/>
      <path d="M39 47H58" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M39 56H58" stroke="${color}" stroke-width="3.5" stroke-linecap="round" opacity="0.7"/>
      <path d="M39 65H53" stroke="${color}" stroke-width="3.5" stroke-linecap="round" opacity="0.55"/>
      <text x="48" y="116" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="white">${label}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const MOCK_BOOKS = [
  {
    id: 'BOOK-001',
    title: 'Đắc Nhân Tâm',
    isbn: '9786049228438',
    author: 'Dale Carnegie',
    genre: 'Kỹ năng sống',
    publisher: 'NXB Tổng hợp TP.HCM',
    thumbnail: createMockCover('DAC NHAN TAM', '#4f46e5'),
  },
  {
    id: 'BOOK-002',
    title: 'Nhà Giả Kim',
    isbn: '9786041062146',
    author: 'Paulo Coelho',
    genre: 'Tiểu thuyết',
    publisher: 'NXB Hội Nhà Văn',
    thumbnail: createMockCover('NHA GIA KIM', '#0f766e'),
  },
  {
    id: 'BOOK-003',
    title: 'Atomic Habits',
    isbn: '9780735211292',
    author: 'James Clear',
    genre: 'Phát triển bản thân',
    publisher: 'Penguin Random House',
    thumbnail: createMockCover('ATOMIC HABITS', '#ea580c'),
  },
  {
    id: 'BOOK-004',
    title: 'Sapiens: Lược Sử Loài Người',
    isbn: '9786041113015',
    author: 'Yuval Noah Harari',
    genre: 'Lịch sử',
    publisher: 'NXB Thế Giới',
    thumbnail: createMockCover('SAPIENS', '#2563eb'),
  },
  {
    id: 'BOOK-005',
    title: 'Tư Duy Nhanh Và Chậm',
    isbn: '9786041177277',
    author: 'Daniel Kahneman',
    genre: 'Tâm lý học',
    publisher: 'NXB Thế Giới',
    thumbnail: createMockCover('THINKING FAST', '#7c3aed'),
  },
];

function BookFormModal({ open, mode, initialData, onClose, onSubmit }) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormData(EMPTY_FORM);
      setError('');
      return;
    }

    setFormData(initialData ?? EMPTY_FORM);
    setError('');
  }, [open, initialData]);

  if (!open) return null;

  const handleChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!formData.title.trim() || !formData.isbn.trim() || !formData.author.trim()) {
      setError('Vui lòng nhập đầy đủ Tên sách, ISBN và Tác giả.');
      return;
    }

    setError('');
    onSubmit({
      ...formData,
      title: formData.title.trim(),
      isbn: formData.isbn.trim(),
      author: formData.author.trim(),
      genre: formData.genre.trim(),
      publisher: formData.publisher.trim(),
      thumbnail: formData.thumbnail.trim() || createMockCover(formData.title.trim().slice(0, 14).toUpperCase(), '#4f46e5'),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {mode === 'edit' ? 'Chỉnh sửa đầu sách' : 'Thêm sách mới'}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Cập nhật thông tin danh mục sách để phục vụ quản lý kho.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tên sách</label>
              <input
                type="text"
                value={formData.title}
                onChange={(event) => handleChange('title', event.target.value)}
                placeholder="Nhập tên đầu sách"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">ISBN</label>
              <input
                type="text"
                value={formData.isbn}
                onChange={(event) => handleChange('isbn', event.target.value)}
                placeholder="9786049228438"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tác giả</label>
              <input
                type="text"
                value={formData.author}
                onChange={(event) => handleChange('author', event.target.value)}
                placeholder="Nhập tên tác giả"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Thể loại</label>
              <input
                type="text"
                value={formData.genre}
                onChange={(event) => handleChange('genre', event.target.value)}
                placeholder="Kỹ năng sống"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nhà xuất bản</label>
              <input
                type="text"
                value={formData.publisher}
                onChange={(event) => handleChange('publisher', event.target.value)}
                placeholder="NXB Tổng hợp TP.HCM"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Ảnh bìa</label>
              <input
                type="text"
                value={formData.thumbnail}
                onChange={(event) => handleChange('thumbnail', event.target.value)}
                placeholder="Dán URL ảnh bìa hoặc để trống để dùng ảnh mẫu"
                className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
            >
              {mode === 'edit' ? 'Lưu thay đổi' : 'Thêm sách'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CoverThumbnail({ src, title }) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="w-10 h-14 bg-indigo-50 rounded flex items-center justify-center border border-indigo-100 overflow-hidden">
        <BookOpen size={18} className="text-indigo-400" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      onError={() => setHasError(true)}
      className="w-10 h-14 rounded object-cover border border-gray-200"
    />
  );
}

export default function BookCatalogPage() {
  const [books, setBooks] = useState(MOCK_BOOKS);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBook, setEditingBook] = useState(null);

  const filteredBooks = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return books;

    return books.filter((book) =>
      [book.title, book.isbn, book.author, book.genre, book.publisher]
        .some((value) => value.toLowerCase().includes(keyword))
    );
  }, [books, search]);

  const handleOpenCreate = () => {
    setEditingBook(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (book) => {
    setEditingBook(book);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setEditingBook(null);
    setIsModalOpen(false);
  };

  const handleSubmit = (payload) => {
    if (editingBook) {
      setBooks((prev) => prev.map((book) => (book.id === editingBook.id ? { ...book, ...payload } : book)));
    } else {
      setBooks((prev) => [
        {
          id: `BOOK-${String(prev.length + 1).padStart(3, '0')}`,
          ...payload,
        },
        ...prev,
      ]);
    }

    handleCloseModal();
  };

  const handleDelete = (id) => {
    setBooks((prev) => prev.filter((book) => book.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản lý danh mục sách</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {books.length} đầu sách trong danh mục
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-sm"
        >
          <Plus size={16} />
          Thêm sách mới
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Tìm theo tên sách, ISBN hoặc tác giả..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-gray-500 uppercase tracking-wide text-left border-b border-gray-200">
                <th className="px-5 py-3 font-semibold">Hình ảnh</th>
                <th className="px-5 py-3 font-semibold">Tên sách</th>
                <th className="px-5 py-3 font-semibold">ISBN</th>
                <th className="px-5 py-3 font-semibold">Tác giả</th>
                <th className="px-5 py-3 font-semibold">Thể loại</th>
                <th className="px-5 py-3 font-semibold">NXB</th>
                <th className="px-5 py-3 font-semibold">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredBooks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400 text-sm">
                    Không tìm thấy đầu sách nào.
                  </td>
                </tr>
              ) : (
                filteredBooks.map((book) => (
                  <tr key={book.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <CoverThumbnail src={book.thumbnail} title={book.title} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="font-semibold text-gray-800">{book.title}</p>
                        <p className="text-xs text-gray-400 font-mono">{book.id}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs font-mono">{book.isbn}</td>
                    <td className="px-5 py-3.5 text-gray-600">{book.author}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                        {book.genre}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{book.publisher}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          title="Chỉnh sửa"
                          onClick={() => handleOpenEdit(book)}
                          className="p-1.5 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          title="Xóa sách"
                          onClick={() => handleDelete(book.id)}
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BookFormModal
        open={isModalOpen}
        mode={editingBook ? 'edit' : 'create'}
        initialData={editingBook}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />
    </div>
  );
}