import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, setToken } from '../services/api';

export default function LoginPage() {
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!identifier.trim() || !password.trim()) {
      setError('Vui long nhap tai khoan va mat khau.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = await login(identifier.trim(), password);
      const token = payload?.token || payload?.accessToken || payload?.data?.token;

      if (!token) {
        throw new Error('Dang nhap thanh cong nhung khong nhan duoc token');
      }

      setToken(token);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const message = err.message || 'Dang nhap that bai.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-800">Dang nhap SmartBook</h1>
        <p className="text-sm text-gray-500 mt-1">Nhap thong tin de truy cap he thong quan ly kho sach.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tai khoan</label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="username hoac email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mat khau</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Dang dang nhap...' : 'Dang nhap'}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-600">
          Chua co tai khoan?{' '}
          <Link to="/register" className="text-indigo-600 hover:text-indigo-700 font-medium">
            Dang ky
          </Link>
        </p>
      </div>
    </div>
  );
}