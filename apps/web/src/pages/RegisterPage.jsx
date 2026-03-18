import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../services/api';

export default function RegisterPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: '',
    email: '',
    full_name: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const onChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.username.trim() || !form.email.trim() || !form.full_name.trim() || !form.password.trim()) {
      setError('Vui long nhap day du thong tin.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await register({
        username: form.username.trim(),
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        password: form.password,
      });

      setSuccess('Dang ky thanh cong. Dang chuyen sang trang dang nhap...');
      setTimeout(() => navigate('/login', { replace: true }), 800);
    } catch (err) {
      setError(err.message || 'Dang ky that bai.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-800">Dang ky SmartBook</h1>
        <p className="text-sm text-gray-500 mt-1">Tao tai khoan de quan tri he thong kho sach.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ho va ten</label>
            <input
              name="full_name"
              type="text"
              value={form.full_name}
              onChange={onChange}
              placeholder="Nguyen Van A"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              name="username"
              type="text"
              value={form.username}
              onChange={onChange}
              placeholder="username"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={onChange}
              placeholder="name@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mat khau</label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={onChange}
              placeholder="********"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          ) : null}

          {success ? (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">{success}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Dang dang ky...' : 'Dang ky'}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-600">
          Da co tai khoan?{' '}
          <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
            Dang nhap
          </Link>
        </p>
      </div>
    </div>
  );
}
