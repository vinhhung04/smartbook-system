import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Sparkles, RotateCcw, Database, Zap } from 'lucide-react';
import { aiService, type ChatMessage, type SystemContext } from '@/services/ai';
import { bookService } from '@/services/book';
import { borrowService } from '@/services/borrow';
import { stockMovementService } from '@/services/stock-movement';
import { toast } from 'sonner';

interface UIMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

const SUGGESTIONS = [
  'Tình hình tồn kho hôm nay?',
  'Sách nào đang quá hạn?',
  'Top sách được mượn nhiều?',
  'Sách nào sắp hết hàng?',
  'Tổng hợp phạt chưa thu?',
  'Gợi ý nhập thêm sách gì?',
];

function MessageText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <span className="text-sm leading-relaxed">
      {lines.map((line, lineIdx) => {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <span key={lineIdx}>
            {lineIdx > 0 && <br />}
            {parts.map((part, i) =>
              i % 2 === 1 ? (
                <strong key={i} className="font-semibold">
                  {part}
                </strong>
              ) : (
                part
              ),
            )}
          </span>
        );
      })}
    </span>
  );
}

async function gatherSystemContext(): Promise<SystemContext> {
  const ctx: SystemContext = {};

  const [bookResp, loanResp, fineResp, movResp] = await Promise.allSettled([
    bookService.getAll(),
    borrowService.getLoans({ pageSize: 30 }),
    borrowService.getFines({ pageSize: 20 }),
    stockMovementService.getAll({ pageSize: 15 }),
  ]);

  if (bookResp.status === 'fulfilled') {
    const books = Array.isArray(bookResp.value) ? bookResp.value : [];
    const totalUnits = books.reduce(
      (s: number, b: any) => s + Number(b.quantity || 0),
      0,
    );
    const lowStock = books.filter(
      (b: any) => Number(b.quantity || 0) > 0 && Number(b.quantity || 0) <= 10,
    ).length;
    const outOfStock = books.filter(
      (b: any) => Number(b.quantity || 0) === 0,
    ).length;

    ctx.summary = {
      totalBooks: books.length,
      totalUnits,
      lowStock,
      outOfStock,
      activeLoans: 0,
      overdueLoans: 0,
      totalFines: 0,
    };

    ctx.books = books
      .map((b: any) => ({
        title: b.title || '?',
        author: b.author || '',
        quantity: Number(b.quantity || 0),
      }))
      .sort((a: any, b: any) => a.quantity - b.quantity);
  }

  if (loanResp.status === 'fulfilled') {
    const loans = Array.isArray(loanResp.value?.data)
      ? loanResp.value.data
      : [];
    const activeLoans = loans.filter(
      (l: any) => l.status === 'BORROWED' || l.status === 'OVERDUE',
    ).length;
    const overdueLoans = loans.filter(
      (l: any) => l.status === 'OVERDUE',
    ).length;

    if (ctx.summary) {
      ctx.summary.activeLoans = activeLoans;
      ctx.summary.overdueLoans = overdueLoans;
    }

    ctx.recentLoans = loans.slice(0, 15).map((l: any) => ({
      loan_number: l.loan_number || l.id?.slice(0, 8),
      customer_name: l.customers?.full_name || l.customer_id?.slice(0, 8) || '?',
      status: l.status,
      due_date: l.due_date || '',
    }));
  }

  if (fineResp.status === 'fulfilled') {
    const fines = Array.isArray(fineResp.value?.data)
      ? fineResp.value.data
      : [];
    const totalFines = fines
      .filter((f: any) => f.status !== 'PAID' && f.status !== 'WAIVED')
      .reduce((s: number, f: any) => s + Number(f.amount || 0), 0);

    if (ctx.summary) {
      ctx.summary.totalFines = totalFines;
    }

    ctx.recentFines = fines.slice(0, 10).map((f: any) => ({
      customer_name: f.customers?.full_name || f.customer_id?.slice(0, 8) || '?',
      fine_type: f.fine_type || '?',
      amount: Number(f.amount || 0),
      status: f.status || '?',
    }));
  }

  if (movResp.status === 'fulfilled') {
    const movements = Array.isArray(movResp.value) ? movResp.value : [];
    ctx.recentMovements = movements.slice(0, 10).map((m: any) => ({
      movement_type: m.movement_type || '?',
      book_title: m.book_title || m.reference_type || '?',
      quantity: Number(m.quantity || 0),
      warehouse_name: m.warehouse_name || '?',
    }));
  }

  return ctx;
}

export function AIChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const systemContextRef = useRef<SystemContext | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshContext = useCallback(async () => {
    try {
      setContextReady(false);
      systemContextRef.current = await gatherSystemContext();
      setContextReady(true);
    } catch {
      systemContextRef.current = undefined;
      setContextReady(true);
    }
  }, []);

  useEffect(() => {
    if (open && !systemContextRef.current) {
      void refreshContext();
    }
  }, [open, refreshContext]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const buildHistory = useCallback((): ChatMessage[] => {
    return messages.map((m) => ({ role: m.role, content: m.text }));
  }, [messages]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setShowSuggestions(false);
    const userMsg: UIMessage = { id: Date.now(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = buildHistory();
      const resp = await aiService.chat(
        trimmed,
        history,
        systemContextRef.current,
      );
      const botMsg: UIMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: resp.reply,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errorMsg: UIMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: 'Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau! 🙏',
      };
      setMessages((prev) => [...prev, errorMsg]);
      toast.error('Không thể kết nối tới AI service');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInput('');
    setShowSuggestions(true);
    void refreshContext();
  };

  const welcomeVisible = messages.length === 0 && !loading;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[380px] h-[540px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold leading-none">
                  SmartBook AI
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {contextReady ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-emerald-200 text-[10px]">
                        Đã kết nối dữ liệu
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-200 text-[10px]">
                        Đang tải dữ liệu...
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void refreshContext()}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Cập nhật dữ liệu"
              >
                <Database size={13} />
              </button>
              <button
                onClick={handleReset}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Cuộc trò chuyện mới"
              >
                <RotateCcw size={13} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
            {/* Welcome state */}
            {welcomeVisible && (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center">
                  <Sparkles size={22} className="text-indigo-600" />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-foreground">
                    Xin chào! Tôi là SmartBook AI 👋
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed max-w-[280px]">
                    Tôi có quyền truy cập dữ liệu thời gian thực của thư viện.
                    Hãy hỏi tôi bất kỳ điều gì!
                  </p>
                </div>
                {showSuggestions && (
                  <div className="w-full space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
                      Gợi ý nhanh
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => void sendMessage(s)}
                          disabled={loading || !contextReady}
                          className="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-100 text-[11px] text-indigo-700 font-medium hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                    <Sparkles size={12} className="text-indigo-600" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white text-gray-700 shadow-sm border border-gray-100 rounded-bl-sm'
                  }`}
                >
                  <MessageText text={msg.text} />
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 shrink-0">
                  <Sparkles size={12} className="text-indigo-600" />
                </div>
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-1.5">
                  <Zap size={12} className="text-indigo-400 animate-pulse" />
                  <span className="text-[11px] text-muted-foreground">
                    Đang phân tích...
                  </span>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Context status bar */}
          {contextReady && systemContextRef.current?.summary && (
            <div className="px-3 py-1.5 bg-indigo-50/60 border-t border-indigo-100/50 flex items-center gap-3 text-[10px] text-indigo-600 shrink-0">
              <span>📚 {systemContextRef.current.summary.totalBooks} sách</span>
              <span>📖 {systemContextRef.current.summary.activeLoans} đang mượn</span>
              {systemContextRef.current.summary.overdueLoans > 0 && (
                <span className="text-rose-600">
                  ⚠️ {systemContextRef.current.summary.overdueLoans} quá hạn
                </span>
              )}
            </div>
          )}

          {/* Footer Input */}
          <div className="px-3 py-3 border-t border-gray-100 bg-white flex items-center gap-2 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(input);
                }
              }}
              placeholder={
                contextReady
                  ? 'Hỏi về sách, tồn kho, mượn/trả...'
                  : 'Đang tải dữ liệu...'
              }
              disabled={loading || !contextReady}
              className="flex-1 text-sm bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || loading || !contextReady}
              className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 hover:from-indigo-700 hover:via-blue-700 hover:to-violet-700 shadow-lg shadow-indigo-500/25 flex items-center justify-center text-white transition-all active:scale-95"
        aria-label="Mở chatbot AI"
      >
        {open ? <X size={22} /> : <Bot size={24} />}
        {!open && (
          <span className="absolute inset-0 rounded-full bg-indigo-500 animate-ping opacity-20" />
        )}
      </button>
    </div>
  );
}
