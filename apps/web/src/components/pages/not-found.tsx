import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Home } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 p-8">
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}
        className="text-[120px] leading-none font-bold bg-gradient-to-br from-indigo-400 to-violet-500 bg-clip-text text-transparent select-none">
        404
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="text-center max-w-md">
        <h1 className="text-[22px] text-slate-800 mb-2" style={{ fontWeight: 700 }}>Page not found</h1>
        <p className="text-[14px] text-slate-400 leading-relaxed">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="flex items-center gap-3">
        <NavLink to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[13px] shadow-lg hover:shadow-xl transition-all"
          style={{ fontWeight: 600 }}>
          <Home className="w-4 h-4" /> Back to Dashboard
        </NavLink>
      </motion.div>
    </div>
  );
}
