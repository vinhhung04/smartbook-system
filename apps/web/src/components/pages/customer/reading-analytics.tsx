import { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen, TrendingUp, Award, Flame, Clock, BarChart3, Loader2, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { customerBorrowService } from '@/services/customer-borrow';
import { aiService, ReadingStatsResponse } from '@/services/ai';
import { toast } from 'sonner';

const PIE_COLORS = ['#6366f1', '#a78bfa', '#c084fc', '#e879f9', '#f472b6', '#38bdf8', '#34d399', '#fbbf24'];

export function CustomerReadingAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ReadingStatsResponse | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const loansResp = await customerBorrowService.getMyLoans();
      const loans = Array.isArray(loansResp?.data) ? loansResp.data : [];

      let reviews: any[] = [];
      try {
        const reviewsResp = await customerBorrowService.getMyReviewForBook('_all');
        reviews = Array.isArray(reviewsResp?.data) ? reviewsResp.data : [];
      } catch { /* reviews are optional */ }

      const result = await aiService.getReadingStats(loans, reviews);
      setStats(result);
    } catch (err) {
      console.error('Failed to load reading stats:', err);
      toast.error('Không thể tải thống kê đọc sách');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStats(); }, [loadStats]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        <p className="text-[13px] text-slate-400">Đang phân tích dữ liệu đọc sách...</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <BookOpen className="w-10 h-10 text-slate-300" />
        <p className="text-[14px] text-slate-500" style={{ fontWeight: 600 }}>Chưa có dữ liệu thống kê</p>
        <p className="text-[12px] text-slate-400">Hãy mượn sách để bắt đầu hành trình đọc sách của bạn!</p>
        <button onClick={() => void loadStats()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[12px] hover:bg-indigo-700 transition-all mt-2">
          <RefreshCw className="w-3.5 h-3.5" /> Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[20px] tracking-[-0.02em]" style={{ fontWeight: 700 }}>Thống kê đọc sách</h1>
            <p className="text-[12px] text-slate-400">Hành trình đọc sách của bạn</p>
          </div>
        </div>
        <button onClick={() => void loadStats()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] hover:bg-slate-50 transition-all">
          <RefreshCw className="w-3.5 h-3.5" /> Làm mới
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tổng sách đã mượn', value: stats.total_books, icon: BookOpen, color: 'from-indigo-500 to-blue-500', bg: 'bg-indigo-50' },
          { label: 'Thời gian mượn TB', value: `${stats.avg_borrow_days} ngày`, icon: Clock, color: 'from-emerald-500 to-teal-500', bg: 'bg-emerald-50' },
          { label: 'Streak liên tục', value: `${stats.streak_months} tháng`, icon: Flame, color: 'from-orange-500 to-red-500', bg: 'bg-orange-50' },
          { label: 'Thành tựu', value: stats.badges.length, icon: Award, color: 'from-violet-500 to-purple-500', bg: 'bg-violet-50' },
        ].map((item, i) => (
          <motion.div key={item.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className={`${item.bg} rounded-xl border p-4 relative overflow-hidden`}>
            <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${item.color}`} />
            <item.icon className="w-5 h-5 text-slate-400 mb-2" />
            <p className="text-[11px] text-slate-500 mb-1" style={{ fontWeight: 550 }}>{item.label}</p>
            <p className="text-[24px] text-slate-800" style={{ fontWeight: 700, lineHeight: 1 }}>{item.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Badges / Achievements */}
      {stats.badges.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-gradient-to-br from-amber-50 to-orange-50/40 rounded-xl border border-amber-100/60 p-5">
          <h3 className="text-[14px] mb-3 flex items-center gap-2" style={{ fontWeight: 650 }}>
            <Award className="w-4 h-4 text-amber-600" /> Thành tựu của bạn
          </h3>
          <div className="flex flex-wrap gap-3">
            {stats.badges.map((badge) => (
              <div key={badge.id} className="flex items-center gap-2 bg-white rounded-lg border border-amber-100 px-3 py-2 shadow-sm">
                <span className="text-[20px]">{badge.icon}</span>
                <div>
                  <p className="text-[12px] text-slate-700" style={{ fontWeight: 600 }}>{badge.name}</p>
                  <p className="text-[10px] text-slate-400">{badge.description}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-[14px] mb-4 flex items-center gap-2" style={{ fontWeight: 650 }}>
            <TrendingUp className="w-4 h-4 text-indigo-500" /> Sách mượn theo tháng
          </h3>
          {stats.monthly_data.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={stats.monthly_data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <defs>
                  <linearGradient id="monthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" vertical={false} />
                <XAxis dataKey="month" fontSize={11} stroke="#94a3b8" />
                <YAxis fontSize={11} stroke="#94a3b8" width={28} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e2e8f0' }} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#monthGrad)" name="Sách" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-[13px]">Chưa có dữ liệu</div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-[14px] mb-4 flex items-center gap-2" style={{ fontWeight: 650 }}>
            <BookOpen className="w-4 h-4 text-violet-500" /> Thể loại yêu thích
          </h3>
          {stats.top_categories.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={stats.top_categories} cx="50%" cy="50%" outerRadius={80} innerRadius={40} dataKey="count"
                  label={({ name, percent }) => `${name.length > 12 ? name.slice(0, 12) + '…' : name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {stats.top_categories.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e2e8f0' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-[13px]">Chưa có dữ liệu</div>
          )}
        </motion.div>
      </div>

      {/* Top Authors */}
      {stats.top_authors.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>Tác giả hay đọc nhất</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.top_authors} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} />
              <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10 }} />
              <Bar dataKey="count" radius={[0, 8, 8, 0]} name="Lần mượn">
                {stats.top_authors.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </div>
  );
}
