import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Sparkles, RotateCcw, Database, Zap } from 'lucide-react';
import { aiService, type ChatMessage, type SystemContext, type PendingAction } from '@/services/ai';
import { bookService } from '@/services/book';
import { borrowService } from '@/services/borrow';
import { stockMovementService } from '@/services/stock-movement';
import { authService, type AuthUser } from '@/services/auth';
import { getPrimaryRole } from '@/lib/rbac';
import { toast } from 'sonner';
import { ActionCard } from './ai-action-card';
import { useMemo } from 'react';

interface UIMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  pending_action?: PendingAction | null;
  action_result?: any;
  intent?: string;
  context_sources?: any[];
  retrieval_warnings?: string[];
  suggestions?: string[];
}

// ── Chat history persistence (localStorage, per-user, survives page reload) ───

const CHAT_HISTORY_KEY_PREFIX = 'smartbook_ai_chat_history:';
const CHAT_HISTORY_MAX_MESSAGES = 40;

function loadStoredMessages(userId: string): UIMessage[] {
  try {
    const raw = localStorage.getItem(`${CHAT_HISTORY_KEY_PREFIX}${userId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredMessages(userId: string, messages: UIMessage[]): void {
  try {
    localStorage.setItem(
      `${CHAT_HISTORY_KEY_PREFIX}${userId}`,
      JSON.stringify(messages.slice(-CHAT_HISTORY_MAX_MESSAGES)),
    );
  } catch {
    // localStorage full/unavailable — chat still works, just without persistence.
  }
}

function getRoleSuggestions(user: AuthUser | null): string[] {
  if (!user) {
    return [
      'SmartBook có những tính năng gì?',
      'Hướng dẫn mượn sách.',
    ];
  }
  const role = getPrimaryRole(user);
  switch (role) {
    case 'CUSTOMER':
      return [
        'Tôi có sách nào sắp đến hạn trả?',
        'Tôi có khoản phạt nào chưa thanh toán?',
        'Gợi ý sách phù hợp với tôi.',
        'Tình trạng đặt sách của tôi?',
      ];
    case 'WAREHOUSE_STAFF':
      return [
        'Task hôm nay của tôi là gì?',
        'Tôi có đơn picking nào cần làm?',
        'Tôi có phiếu putaway nào được giao?',
        'Báo cáo ngoại lệ của tôi.',
      ];
    case 'WAREHOUSE_MANAGER':
    case 'ADMIN':
      return [
        'Tổng quan vận hành hôm nay.',
        'Có task nào chưa giao nhân viên?',
        'Sách nào tồn kho thấp?',
        'Tổng quan loan và phạt hôm nay.',
      ];
    case 'LIBRARIAN':
      return [
        'Có loan nào quá hạn?',
        'Reservation nào đang chờ xử lý?',
        'Khách nào có phạt chưa thanh toán?',
        'Tình trạng mượn trả hôm nay.',
      ];
    default:
      return [
        'Nên nhập thêm sách nào? Tạo đề xuất nhập thêm giúp tôi.',
        'Cảnh báo các sách tồn kho thấp.',
        'Tạo task cho staff kiểm tra các sách sắp hết hàng.',
        'Sách nào đang quá hạn?',
      ];
  }
}

function getPageSuggestions(pathname: string, user: AuthUser | null): string[] | null {
  if (pathname.includes('/picking')) return [
    'Task lấy hàng nào đang chờ tôi?',
    'Hướng dẫn quy trình quét barcode.',
    'Có đơn REPICK nào đang mở không?',
  ];
  if (pathname.includes('/outbound')) return [
    'Đơn xuất kho nào chưa xác nhận?',
    'Tổng hợp tình trạng xuất kho hôm nay.',
  ];
  if (pathname.includes('/putaway')) return [
    'Phiếu nhập nào đang chờ cất hàng?',
    'Vị trí kệ nào còn chỗ trống?',
  ];
  if (pathname.includes('/borrow/loans')) return [
    'Có loan nào quá hạn hôm nay?',
    'Nhắc nhở khách hàng trả sách.',
    'Loan nào đến hạn trong 3 ngày tới?',
  ];
  if (pathname.includes('/borrow/reservations')) return [
    'Đặt trước nào đang chờ xác nhận?',
    'Có reservation nào sắp hết hạn?',
  ];
  if (pathname.includes('/borrow/fines')) return [
    'Khách nào có phạt cao nhất?',
    'Tổng tiền phạt chưa thu là bao nhiêu?',
  ];
  if (pathname.includes('/purchase-orders') || pathname.includes('/purchase-requests')) return [
    'PO nào đang chờ xác nhận từ NCC?',
    'Yêu cầu mua hàng nào cần duyệt gấp?',
  ];
  if (pathname.includes('/exception-reports')) return [
    'Báo cáo sự cố nào đang mở?',
    'Tổng hợp ngoại lệ theo loại hàng.',
  ];
  if (pathname.includes('/inventory') || pathname.includes('/movements')) return [
    'Sách nào tồn kho dưới ngưỡng tối thiểu?',
    'Biến động tồn kho trong tuần này.',
    'Đề xuất nhập thêm các sách sắp hết.',
  ];
  if (pathname.includes('/my-warehouse-tasks')) return [
    'Task nào tôi có thể tự nhận ngay?',
    'Tóm tắt công việc của tôi hôm nay.',
  ];
  if (pathname.includes('/customer/loans')) return [
    'Sách nào của tôi sắp đến hạn?',
    'Tôi có thể gia hạn được không?',
  ];
  if (pathname.includes('/customer/reservations')) return [
    'Đặt trước nào của tôi đã sẵn sàng nhận?',
  ];
  return getRoleSuggestions(user);
}

function getWelcomeGreeting(user: AuthUser | null): string {
  if (!user) return 'Xin chào! Tôi là SmartBook AI 👋';
  const name = user.full_name || user.username;
  const roleLabel: Record<string, string> = {
    ADMIN: 'Admin',
    WAREHOUSE_MANAGER: 'Quản lý kho',
    LIBRARIAN: 'Thủ thư',
    WAREHOUSE_STAFF: 'Nhân viên kho',
    CUSTOMER: '',
    SUPPLIER: 'Nhà cung cấp',
  };
  const role = getPrimaryRole(user);
  const label = roleLabel[role] ?? '';
  return label
    ? `Xin chào ${label} **${name}**! 👋`
    : `Xin chào **${name}**! 👋`;
}

// Risk/status badges, PayloadPreview, and ActionCard now live in ./ai-action-card.tsx

// ── Report result display ─────────────────────────────────────────────────────

function ReportResult({ markdown }: { markdown: string }) {
  return (
    <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-2 max-h-48 overflow-y-auto">
      <MessageText text={markdown} />
    </div>
  );
}

// ── MessageText ───────────────────────────────────────────────────────────────

function MessageText({ text }: { text: string }) {
  const lines = text.split('\n');

  function renderInline(line: string) {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold">
          {part}
        </strong>
      ) : (
        part
      ),
    );
  }

  const elements: React.ReactNode[] = [];
  let listBuffer: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;

  function flushList() {
    if (!listBuffer) return;
    const { type, items } = listBuffer;
    const Tag = type;
    elements.push(
      <Tag key={`list-${elements.length}`} className={type === 'ul' ? 'list-disc ml-4 space-y-0.5' : 'list-decimal ml-4 space-y-0.5'}>
        {items}
      </Tag>,
    );
    listBuffer = null;
  }

  lines.forEach((line, idx) => {
    // Heading level 1: # Text
    if (/^#\s+/.test(line)) {
      flushList();
      elements.push(
        <p key={idx} className="font-semibold text-[12px] mt-2 mb-0.5">
          {renderInline(line.replace(/^#+\s+/, ''))}
        </p>,
      );
      return;
    }
    // Heading level 2: ## Text
    if (/^##\s+/.test(line)) {
      flushList();
      elements.push(
        <p key={idx} className="font-semibold text-[11px] mt-1.5 mb-0.5 text-gray-600">
          {renderInline(line.replace(/^#+\s+/, ''))}
        </p>,
      );
      return;
    }
    // Unordered list: - item or * item
    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      if (!listBuffer || listBuffer.type !== 'ul') {
        flushList();
        listBuffer = { type: 'ul', items: [] };
      }
      listBuffer.items.push(
        <li key={idx} className="text-[11px] leading-snug">
          {renderInline(ulMatch[1])}
        </li>,
      );
      return;
    }
    // Ordered list: 1. item
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (!listBuffer || listBuffer.type !== 'ol') {
        flushList();
        listBuffer = { type: 'ol', items: [] };
      }
      listBuffer.items.push(
        <li key={idx} className="text-[11px] leading-snug">
          {renderInline(olMatch[1])}
        </li>,
      );
      return;
    }
    // Blank line — flush list, add spacer
    if (line.trim() === '') {
      flushList();
      elements.push(<br key={idx} />);
      return;
    }
    // Normal text line
    flushList();
    elements.push(
      <span key={idx} className="block text-[11px] leading-snug">
        {renderInline(line)}
      </span>,
    );
  });

  flushList();

  return <div className="text-sm leading-relaxed space-y-0.5">{elements}</div>;
}

// ── System context gathering ──────────────────────────────────────────────────

async function gatherSystemContext(user: AuthUser | null): Promise<SystemContext | undefined> {
  // Backend fetches personal context for these roles; no need to send system_context.
  const role = user ? getPrimaryRole(user) : null;
  const skipRoles = new Set(['CUSTOMER', 'WAREHOUSE_STAFF', 'SUPPLIER']);
  if (role && skipRoles.has(role)) return undefined;

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

// ── Main AIChatbot component ──────────────────────────────────────────────────

export function AIChatbot() {
  const [currentUser] = useState<AuthUser | null>(() => authService.getCurrentUser());
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>(() => loadStoredMessages(currentUser?.id || 'anon'));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextReady, setContextReady] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(() => messages.length === 0);
  const [systemContext, setSystemContext] = useState<SystemContext | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageIdRef = useRef(messages.reduce((highest, message) => Math.max(highest, message.id), 0));

  useEffect(() => {
    saveStoredMessages(currentUser?.id || 'anon', messages);
  }, [messages, currentUser?.id]);

  const refreshContext = useCallback(async () => {
    try {
      setContextReady(false);
      setSystemContext(await gatherSystemContext(currentUser));
      setContextReady(true);
    } catch {
      setSystemContext(undefined);
      setContextReady(true);
    }
  }, [currentUser]);

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
    const userMsg: UIMessage = { id: ++messageIdRef.current, role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const history = buildHistory();
    const botMsgId = ++messageIdRef.current;
    // The assistant bubble is only added to `messages` once the first chunk
    // arrives, so the typing indicator (shown while `loading`) isn't doubled
    // up with an empty message bubble in the meantime.
    let started = false;

    await aiService.chatStream(trimmed, history, systemContext, {
      onToken: (chunk) => {
        if (!started) {
          started = true;
          setLoading(false);
          setMessages((prev) => [...prev, { id: botMsgId, role: 'assistant', text: chunk }]);
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === botMsgId ? { ...m, text: m.text + chunk } : m)),
          );
        }
      },
      onDone: (resp) => {
        setLoading(false);
        // `resp.reply` is authoritative — it includes the source-line/agent
        // -confirmation sentences appended after streaming finished, which
        // the raw token chunks don't have yet.
        const finalFields = {
          text: resp.reply,
          pending_action: resp.pending_action ?? null,
          intent: resp.intent,
          context_sources: resp.context_sources,
          retrieval_warnings: resp.retrieval_warnings,
        };
        setMessages((prev) =>
          started
            ? prev.map((m) => (m.id === botMsgId ? { ...m, ...finalFields } : m))
            : [...prev, { id: botMsgId, role: 'assistant', ...finalFields }],
        );
      },
      onError: () => {
        setLoading(false);
        const errorText = 'Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau! 🙏';
        setMessages((prev) =>
          started
            ? prev.map((m) => (m.id === botMsgId ? { ...m, text: errorText } : m))
            : [...prev, { id: botMsgId, role: 'assistant', text: errorText }],
        );
        toast.error('Không thể kết nối tới AI service');
      },
    });
  };

  const ACTION_FOLLOWUP_SUGGESTIONS = useMemo<Record<string, string[]>>(() => ({
    CREATE_STOCK_ALERT: [
      'Tạo phiếu yêu cầu nhập hàng cho các sách tồn kho thấp',
      'Tạo task cho staff kiểm tra các sách hết hàng',
    ],
    CREATE_REORDER_DRAFT: [
      'Xem danh sách phiếu yêu cầu nhập vừa tạo',
      'Tạo báo cáo tổng quan tồn kho',
    ],
    CREATE_STAFF_TASK_DRAFT: [
      'Xem task của tôi hôm nay',
      'Tạo thêm task cho nhân viên khác',
    ],
    CREATE_REPORT_DRAFT: [
      'Tạo cảnh báo tồn kho thấp',
      'Nên nhập thêm sách nào?',
    ],
  }), []);

  const handleActionConfirmed = useCallback((_actionId: string, result: any, actionType: string) => {
    const followUpSuggestions = ACTION_FOLLOWUP_SUGGESTIONS[actionType] ?? [];

    if (result?.report_markdown) {
      setMessages((prev) => [
        ...prev,
        {
          id: ++messageIdRef.current,
          role: 'assistant',
          text: '✅ Hành động đã xác nhận. Xem báo cáo bên dưới.',
          action_result: result,
          suggestions: followUpSuggestions,
        },
      ]);
      return;
    }

    const modeLabelGeneral: Record<string, string> = {
      real_api: '✅ Đã tạo thật trong hệ thống.',
      partial: '⚠️ Một phần tạo thành công, một phần thất bại hoặc bị bỏ qua.',
      draft_only: '📋 Chỉ tạo bản nháp — chưa có bản ghi thật trong hệ thống.',
      generated: '✅ Hành động đã hoàn thành.',
    };

    const modeText = result?.mode ? (modeLabelGeneral[result.mode] ?? '') : '';
    const baseMessage = result?.message || 'Hành động đã được thực thi.';

    // Reorder: show PR numbers grouped by warehouse with supplier info
    const createdReqs: any[] = result?.created_requests ?? [];
    let requestLine = '';
    if (createdReqs.length > 0) {
      // Group by warehouse
      const byWh: Record<string, { wh: string; prs: string[]; supplier: string }> = {};
      for (const r of createdReqs) {
        const key = r.warehouse_name || 'Chưa rõ kho';
        if (!byWh[key]) byWh[key] = { wh: key, prs: [], supplier: r.suggested_supplier_name || '' };
        if (r.request_number) byWh[key].prs.push(r.request_number);
      }
      const whLines = Object.values(byWh)
        .map((g) => `  ${g.wh}: ${g.prs.join(', ')}${g.supplier ? ` (NCC: ${g.supplier})` : ''}`)
        .join('\n');
      requestLine = `\nĐã tạo ${createdReqs.length} phiếu:\n${whLines}`;
    }
    // Show no-warehouse skipped items
    const noWhItems: string[] = result?.no_warehouse_items ?? [];
    const noWhLine = noWhItems.length > 0
      ? `\nBỏ qua (thiếu kho): ${noWhItems.slice(0, 3).join(', ')}${noWhItems.length > 3 ? '...' : ''}`
      : '';

    // Stock alert: show created alert count
    const createdAlerts: any[] = result?.created_alerts ?? [];
    const alertLine = createdAlerts.length > 0
      ? `\nĐã tạo ${createdAlerts.length} cảnh báo tồn kho.`
      : '';
    const duplicateAlerts: string[] = result?.duplicate_items ?? [];
    const dupLine = duplicateAlerts.length > 0
      ? `\n${duplicateAlerts.length} cảnh báo đã tồn tại (bỏ qua).`
      : '';

    // Staff task: show task info
    const taskResult = result?.task;
    const taskLine = taskResult
      ? `\nTask đã tạo${taskResult.id ? ` (ID: ${String(taskResult.id).slice(0, 8)})` : ''}.`
      : '';

    // Skipped items (reorder + stock alert)
    const skippedItems: string[] = result?.skipped_items ?? [];
    const skippedLine = skippedItems.length > 0
      ? `\nBỏ qua (thiếu variant_id): ${skippedItems.slice(0, 3).join(', ')}${skippedItems.length > 3 ? '...' : ''}`
      : '';

    const fullText = [modeText, baseMessage, requestLine, noWhLine, alertLine, dupLine, taskLine, skippedLine]
      .filter(Boolean)
      .join('\n')
      .trim();

    setMessages((prev) => [
      ...prev,
      {
        id: ++messageIdRef.current,
        role: 'assistant',
        text: fullText || 'Hành động đã được thực thi.',
        action_result: result,
        suggestions: followUpSuggestions,
      },
    ]);
  }, [ACTION_FOLLOWUP_SUGGESTIONS]);

  const handleActionCancelled = useCallback((_actionId: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: ++messageIdRef.current,
        role: 'assistant',
        text: 'Đã hủy hành động.',
      },
    ]);
  }, []);

  const handleReset = () => {
    setMessages([]);
    setInput('');
    setShowSuggestions(true);
    setSystemContext(undefined);
    setContextReady(true);
  };

  const welcomeVisible = messages.length === 0 && !loading;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[400px] h-[580px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold leading-none">
                  SmartBook AI Agent
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {contextReady ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-emerald-200 text-[10px]">
                        AI sẽ truy xuất dữ liệu khi bạn đặt câu hỏi
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-200 text-[10px]">
                        Đang nạp fallback context...
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
                title="Nạp fallback context"
              >
                <Database size={13} />
              </button>
              <button
                onClick={handleReset}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Làm mới phiên chat"
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
                    <MessageText text={getWelcomeGreeting(currentUser)} />
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed max-w-[300px]">
                    Tôi có thể truy xuất dữ liệu thời gian thực và tạo các hành động cần xác nhận của bạn.
                  </p>
                </div>
                {showSuggestions && (() => {
                  const suggestions = getPageSuggestions(window.location.pathname, currentUser);
                  const isPageSpecific = suggestions !== getRoleSuggestions(currentUser);
                  return (
                    <div className="w-full space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
                        {isPageSpecific ? 'Gợi ý cho trang này' : 'Gợi ý nhanh'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(suggestions || []).map((s) => (
                          <button
                            key={s}
                            onClick={() => void sendMessage(s)}
                            disabled={loading}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-100 text-[11px] text-indigo-700 font-medium hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
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
                <div className={`max-w-[88%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`px-3 py-2 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-white text-gray-700 shadow-sm border border-gray-100 rounded-bl-sm'
                    }`}
                  >
                    <MessageText text={msg.text} />
                  </div>

                  {/* Action card — only on assistant messages */}
                  {msg.role === 'assistant' && msg.pending_action && (
                    <div className="w-full">
                      <ActionCard
                        action={msg.pending_action}
                        onConfirmed={handleActionConfirmed}
                        onCancelled={handleActionCancelled}
                      />
                    </div>
                  )}

                  {/* Report result */}
                  {msg.role === 'assistant' && msg.action_result?.report_markdown && (
                    <div className="w-full">
                      <ReportResult markdown={msg.action_result.report_markdown} />
                    </div>
                  )}

                  {/* Retrieval warnings */}
                  {msg.role === 'assistant' && msg.retrieval_warnings && msg.retrieval_warnings.length > 0 && (
                    <div className="mt-1 space-y-0.5 w-full">
                      {msg.retrieval_warnings.slice(0, 2).map((w, i) => (
                        <p key={i} className="text-[10px] text-amber-500">⚠ {w}</p>
                      ))}
                    </div>
                  )}

                  {/* Data sources */}
                  {msg.role === 'assistant' && msg.context_sources && msg.context_sources.length > 0 && (() => {
                    const okSources = msg.context_sources
                      .filter((s: any) => s.status === 'ok')
                      .map((s: any) => s.name as string);
                    return okSources.length > 0 ? (
                      <p className="text-[9px] text-gray-400 mt-0.5">
                        Nguồn: {okSources.join(', ')}
                      </p>
                    ) : null;
                  })()}

                  {/* Follow-up suggestion chips */}
                  {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {msg.suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => void sendMessage(s)}
                          disabled={loading}
                          className="px-2.5 py-1 rounded-lg bg-white border border-indigo-100 text-[11px] text-indigo-700 font-medium hover:bg-indigo-50 hover:border-indigo-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
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
          {contextReady && systemContext?.summary && (
            <div className="px-3 py-1.5 bg-indigo-50/60 border-t border-indigo-100/50 flex items-center gap-3 text-[10px] text-indigo-600 shrink-0">
              <span>📚 {systemContext.summary.totalBooks} sách</span>
              <span>📖 {systemContext.summary.activeLoans} đang mượn</span>
              {systemContext.summary.overdueLoans > 0 && (
                <span className="text-rose-600">
                  ⚠️ {systemContext.summary.overdueLoans} quá hạn
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
              placeholder="Hỏi về sách, tồn kho, hoặc tạo hành động..."
              disabled={loading}
              className="flex-1 text-sm bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || loading}
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
