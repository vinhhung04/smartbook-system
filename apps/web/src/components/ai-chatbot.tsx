import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, ArrowUp, ArrowDown, ArrowRight, Square, Database, Camera, AlertTriangle, Copy, Check, Maximize2, Minimize2,
  History, MessageSquarePlus, Mic, Trash2, RotateCcw,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  SmartBookAiMark, BookDueIcon, BookFineIcon, BookReserveIcon, BookRulesIcon, BookStackIcon, BookPileIcon,
  BookTaskIcon, SparkIcon,
} from './ai-experience/smartbook-icons';
import { cn } from '@/components/ui/utils';
import { aiService, type ChatMessage, type SystemContext, type PendingAction } from '@/services/ai';
import { bookService } from '@/services/book';
import { borrowService } from '@/services/borrow';
import { stockMovementService } from '@/services/stock-movement';
import { authService, type AuthUser } from '@/services/auth';
import { getPrimaryRole, canAccess, ROUTE_ACCESS } from '@/lib/rbac';
import { customerBorrowService } from '@/services/customer-borrow';
import { timeAgo } from '@/lib/time-ago';
import {
  loadStore, saveStore, upsertActive, startConversation, removeConversation, restoreConversation,
  type ConversationStore,
} from '@/lib/chat-history';
import type { RecordKind } from '@/lib/chat-markdown';
import { useSpeechInput } from '@/hooks/use-speech-input';
import { ChatMarkdown, type RecordLinks } from './ai-experience/chat-markdown';
import { ReaderActions, ReaderDigest, useReaderSnapshot } from './ai-experience/reader-panels';
import { followUpsFor } from '@/lib/chat-reader';
import { toast } from 'sonner';
import { ActionCard } from './ai-action-card';
import { onChatbotAsk } from '@/lib/chatbot-bus';
import { useMemo } from 'react';
import {
  aiExperienceService, AiHttpError, type AiCapabilities, type AiExplainability, type BookRecognition,
  type RecognitionCandidate, type TurnImage,
} from '@/services/ai-experience';
import { usePhotoAttachment, STAGE_LABEL } from './ai-experience/use-photo-attachment';
import { PhotoAttachButton, PhotoPreview } from './ai-experience/photo-composer';
import { BookRecognitionCard } from './ai-experience/book-recognition-card';
import { EvidencePanel } from './ai-experience/evidence-panel';

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
  // Phase F (no image data is ever stored here - only the recognised references)
  hasPhoto?: boolean;
  recognition?: BookRecognition;
  pendingQuestion?: string;
  chosenBookId?: string | null;
  explainability?: AiExplainability | null;
  stopped?: boolean;
  /** The request failed; the reader can send the same question again. */
  failed?: boolean;
  /** When the message was written (ms); older saved messages have none. */
  at?: number;
}

const DEFAULT_PHOTO_QUESTION = 'Đây là sách gì? Thư viện còn không?';
const EXPERIENCE_LABEL: Record<string, string> = {
  reader: 'Trợ lý độc giả', warehouse_work: 'Trợ lý công việc kho', library_operations: 'Trợ lý nghiệp vụ thư viện',
  supplier: 'Trợ lý nhà cung cấp', decision_assistant: 'Trợ lý quản lý', general: 'Trợ lý', anonymous: 'Trợ lý',
};

// Saved conversations live in src/lib/chat-history.ts (this browser only, per account).
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function messageTime(at?: number): string | null {
  if (!at) return null;
  const d = new Date(at);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${time}`;
}

function updatedLabel(at: number): string {
  const ago = timeAgo(new Date(at).toISOString());
  return /^\d+ (phút|giờ|ngày)$/.test(ago) ? `${ago} trước` : ago;
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

function getPageSuggestions(pathname: string, user: AuthUser | null, starters?: string[]): string[] | null {
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
  // Phase F: starters built by the backend from the capabilities the user holds.
  return starters && starters.length > 0 ? starters : getRoleSuggestions(user);
}

function getWelcomeGreeting(user: AuthUser | null): string {
  return user ? `Chào ${user.full_name || user.username}` : 'Chào bạn';
}

function getWelcomeIntro(role: string | null, photo: boolean): string {
  if (role === 'CUSTOMER') {
    return `Hỏi về sách bạn đang mượn, hạn trả, phí phạt, đặt trước hoặc quy định thư viện.${photo ? ' Gửi ảnh bìa để tìm một cuốn sách.' : ''}`;
  }
  if (role === 'SUPPLIER') return 'Hỏi về đơn đặt mua, hóa đơn giao hàng và các khoản giao thiếu.';
  if (!role) return 'Hỏi về SmartBook và cách mượn sách tại thư viện.';
  return 'Hỏi về tồn kho, mượn trả và công việc. Mọi hành động AI soạn đều chờ bạn xác nhận trước khi thực hiện.';
}

/** A topic icon for a suggested question, matched on its words. */
function suggestionIcon(text: string) {
  const t = text.toLowerCase();
  if (/phạt|thanh toán|tiền/.test(t)) return BookFineIcon;
  if (/hạn/.test(t)) return BookDueIcon;
  if (/đặt|reservation/.test(t)) return BookReserveIcon;
  if (/quy định|hướng dẫn|quy trình|tính năng/.test(t)) return BookRulesIcon;
  if (/kho|nhập|xuất|putaway|picking|po\b/.test(t)) return BookPileIcon;
  if (/task|công việc|báo cáo|ngoại lệ/.test(t)) return BookTaskIcon;
  if (/sách/.test(t)) return BookStackIcon;
  return SparkIcon;
}

function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }, () => toast.error('Không sao chép được câu trả lời.'))}
      aria-label="Sao chép câu trả lời"
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? 'Đã sao chép' : 'Sao chép'}
    </button>
  );
}

// Risk/status badges, PayloadPreview, and ActionCard now live in ./ai-action-card.tsx

// ── Report result display ─────────────────────────────────────────────────────

function ReportResult({ markdown }: { markdown: string }) {
  return (
    <div className="mt-2 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-muted/40 p-3">
      <ChatMarkdown text={markdown} />
    </div>
  );
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

// `aboveBottomNav`: the customer portal has a fixed phone tab bar below lg.
export function AIChatbot({ aboveBottomNav = false }: { aboveBottomNav?: boolean }) {
  const [currentUser] = useState<AuthUser | null>(() => authService.getCurrentUser());
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const userKey = currentUser?.id || 'anon';
  const [store, setStore] = useState<ConversationStore<UIMessage>>(() => loadStore<UIMessage>(browserStorage(), userKey));
  const [messages, setMessages] = useState<UIMessage[]>(
    () => store.conversations.find((c) => c.id === store.activeId)?.messages ?? [],
  );
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [unread, setUnread] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const navigate = useNavigate();
  const readerAccount = !!currentUser && getPrimaryRole(currentUser) === 'CUSTOMER';
  // A reader's loans and fines, fetched each time the chatbox opens.
  const snapshot = useReaderSnapshot(readerAccount && open);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // True for the whole /chat/stream request, also after the first token has
  // replaced the typing indicator (`loading`), so the send button can stop it.
  const [streaming, setStreaming] = useState(false);
  const streamingMsgId = useRef<number | null>(null);
  const [contextReady, setContextReady] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(() => messages.length === 0);
  const [systemContext, setSystemContext] = useState<SystemContext | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new text only while the reader is at the bottom; scrolling up stops it.
  const stickRef = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageIdRef = useRef(messages.reduce((highest, message) => Math.max(highest, message.id), 0));
  // The in-flight /chat/stream request: aborted on reset and on unmount so a
  // late reply never lands in a cleared chat and the server stops generating.
  const streamRef = useRef<AbortController | null>(null);
  useEffect(() => () => streamRef.current?.abort(), []);
  const [caps, setCaps] = useState<AiCapabilities | null>(null);
  const photo = usePhotoAttachment();
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  // The recognised book later questions may refer to ("sách này"); the server
  // decides whether a question really refers to it.
  const [activeImage, setActiveImage] = useState<{ attachment_id: string; book_id?: string | null; title?: string | null } | null>(null);
  const lastPhotoQuestion = useRef('');

  useEffect(() => {
    if (!open || caps) return;
    aiExperienceService.getCapabilities().then(setCaps).catch(() => setCaps(null));
  }, [open, caps]);

  useEffect(() => {
    setStore((s) => upsertActive(s, messages));
  }, [messages]);

  useEffect(() => {
    saveStore(browserStorage(), userKey, store);
  }, [store, userKey]);

  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

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
    if (open && view === 'chat' && stickRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open, loading, view]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = gap < 80;
    setAwayFromBottom(gap > 160);
  };

  const scrollToLatest = () => {
    stickRef.current = true;
    setAwayFromBottom(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A page hands over a question (chatbot-bus): asked at once when the page says so
  // and nothing is in flight, otherwise left in the composer for the user to send.
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
  const busyRef = useRef(false);
  useEffect(() => onChatbotAsk((prompt, { send }) => {
    setOpen(true);
    setView('chat');
    if (send && !busyRef.current) {
      void sendRef.current(prompt);
      return;
    }
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 0);
  }), []);

  const buildHistory = useCallback((): ChatMessage[] => {
    return messages.map((m) => ({ role: m.role, content: m.text }));
  }, [messages]);

  const streamReply = async (trimmed: string, image?: TurnImage, addUser = true, historyOverride?: ChatMessage[]) => {
    setShowSuggestions(false);
    if (addUser) {
      const userMsg: UIMessage = { id: ++messageIdRef.current, role: 'user', text: trimmed, at: Date.now() };
      stickRef.current = true;
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
    }
    setLoading(true);

    const history = historyOverride ?? buildHistory();
    const botMsgId = ++messageIdRef.current;
    // The assistant bubble is only added to `messages` once the first chunk
    // arrives, so the typing indicator (shown while `loading`) isn't doubled
    // up with an empty message bubble in the meantime.
    let started = false;
    const controller = new AbortController();
    streamRef.current = controller;
    streamingMsgId.current = botMsgId;
    setStreaming(true);

    await aiService.chatStream(trimmed, history, systemContext, {
      signal: controller.signal,
      image,
      onToken: (chunk) => {
        if (!started) {
          started = true;
          setLoading(false);
          setMessages((prev) => [...prev, { id: botMsgId, role: 'assistant', text: chunk, at: Date.now() }]);
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
          explainability: resp.explainability ?? null,
        };
        setMessages((prev) =>
          started
            ? prev.map((m) => (m.id === botMsgId ? { ...m, ...finalFields } : m))
            : [...prev, { id: botMsgId, role: 'assistant', at: Date.now(), ...finalFields }],
        );
        if (!openRef.current) setUnread(true);
      },
      onError: (err) => {
        setLoading(false);
        const photoGone = err instanceof AiHttpError && (err.status === 410 || err.status === 400) && image;
        if (photoGone) setActiveImage(null);
        const errorText = photoGone
          ? (err as AiHttpError).message
          : 'AI tạm thời không khả dụng. Các nghiệp vụ thư viện và kho vẫn hoạt động bình thường.';
        setMessages((prev) =>
          started
            ? prev.map((m) => (m.id === botMsgId ? { ...m, text: errorText, failed: true } : m))
            : [...prev, { id: botMsgId, role: 'assistant', text: errorText, at: Date.now(), failed: true }],
        );
        toast.error('AI tạm thời không khả dụng');
      },
    });
    if (streamRef.current === controller) {
      streamRef.current = null;
      setStreaming(false);
    }
  };

  // Abort is quiet (no onDone), so the partial answer stays and is marked stopped.
  const stopReply = () => {
    streamRef.current?.abort();
    streamRef.current = null;
    setLoading(false);
    setStreaming(false);
    const id = streamingMsgId.current;
    if (id === null) return;
    setMessages((prev) => (prev.some((m) => m.id === id)
      ? prev.map((m) => (m.id === id ? { ...m, stopped: true } : m))
      : [...prev, { id, role: 'assistant', text: 'Đã dừng trả lời.', stopped: true }]));
  };

  const runPhoto = async (question: string) => {
    lastPhotoQuestion.current = question;
    setLoading(true);
    const rec = await photo.identify();
    setLoading(false);
    if (!rec) return; // the preview shows the error and a retry button
    photo.clear();
    const top = rec.candidates[0];
    setMessages((prev) => [...prev, {
      id: ++messageIdRef.current, role: 'assistant', text: rec.explanation.summary, recognition: rec, at: Date.now(),
      pendingQuestion: question, chosenBookId: rec.status === 'IDENTIFIED' ? top?.book_id : null,
    }]);
    if (rec.status === 'IDENTIFIED' && top) {
      setActiveImage({ attachment_id: rec.attachment_id, book_id: top.book_id, title: top.title });
      await streamReply(question, { attachment_id: rec.attachment_id, book_id: top.book_id, image_turn: true }, false);
    } else {
      setActiveImage(null);
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (loading || streaming) return;
    if (photo.file) {
      const question = trimmed || DEFAULT_PHOTO_QUESTION;
      setShowSuggestions(false);
      stickRef.current = true;
      setMessages((prev) => [...prev, { id: ++messageIdRef.current, role: 'user', text: question, hasPhoto: true, at: Date.now() }]);
      setInput('');
      await runPhoto(question);
      return;
    }
    if (!trimmed) return;
    await streamReply(trimmed, activeImage ? { attachment_id: activeImage.attachment_id, book_id: activeImage.book_id } : undefined);
  };

  sendRef.current = sendMessage;
  busyRef.current = loading || streaming;

  const retryAnswer = (assistantId: number) => {
    if (loading || streaming) return;
    const at = messages.findIndex((m) => m.id === assistantId);
    let q = at - 1;
    while (q >= 0 && messages[q].role !== 'user') q -= 1;
    if (at < 0 || q < 0) return;
    const prior = messages.slice(0, q).map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    stickRef.current = true;
    void streamReply(messages[q].text, activeImage ? { attachment_id: activeImage.attachment_id, book_id: activeImage.book_id } : undefined, false, prior);
  };

  const chooseCandidate = (msgId: number, rec: BookRecognition, candidate: RecognitionCandidate) => {
    if (loading) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, chosenBookId: candidate.book_id } : m)));
    setActiveImage({ attachment_id: rec.attachment_id, book_id: candidate.book_id, title: candidate.title });
    const question = messages.find((m) => m.id === msgId)?.pendingQuestion || DEFAULT_PHOTO_QUESTION;
    void streamReply(question, { attachment_id: rec.attachment_id, book_id: candidate.book_id, image_turn: true }, false);
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
          text: 'Hành động đã được xác nhận. Báo cáo ở bên dưới.',
          action_result: result,
          suggestions: followUpSuggestions,
        },
      ]);
      return;
    }

    const modeLabelGeneral: Record<string, string> = {
      real_api: 'Đã tạo thật trong hệ thống.',
      partial: 'Một phần tạo thành công, một phần thất bại hoặc bị bỏ qua.',
      draft_only: 'Chỉ tạo bản nháp, chưa có bản ghi thật trong hệ thống.',
      generated: 'Hành động đã hoàn thành.',
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

  // Speech fills the composer; it never sends on its own, so the reader can check the words first.
  const speechBase = useRef('');
  const speech = useSpeechInput({
    onText: (text) => setInput(speechBase.current ? `${speechBase.current} ${text}` : text),
  });
  const toggleSpeech = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speechBase.current = input.trim();
    speech.start();
  };

  // Leaving the open conversation: stop the reply in flight and drop what belongs to it.
  const leaveConversation = () => {
    streamRef.current?.abort();
    speech.stop();
    setLoading(false);
    setStreaming(false);
    setInput('');
    setSystemContext(undefined);
    setContextReady(true);
    setActiveImage(null);
    photo.clear();
    stickRef.current = true;
    setAwayFromBottom(false);
  };

  // The current conversation stays in the history; a new one starts.
  const handleReset = () => {
    leaveConversation();
    setMessages([]);
    setShowSuggestions(true);
    setStore((s) => startConversation(s));
    setView('chat');
  };

  const openConversation = (id: string) => {
    const conversation = store.conversations.find((c) => c.id === id);
    if (!conversation) return;
    leaveConversation();
    setStore((s) => ({ ...s, activeId: id }));
    setMessages(conversation.messages);
    messageIdRef.current = conversation.messages.reduce((highest, m) => Math.max(highest, m.id), 0);
    setShowSuggestions(conversation.messages.length === 0);
    setView('chat');
  };

  const deleteConversation = (id: string) => {
    const removed = store.conversations.find((c) => c.id === id);
    if (!removed) return;
    if (id === store.activeId) {
      leaveConversation();
      setMessages([]);
      setShowSuggestions(true);
    }
    setStore((s) => removeConversation(s, id));
    toast('Đã xóa cuộc trò chuyện', {
      action: { label: 'Hoàn tác', onClick: () => setStore((s) => restoreConversation(s, removed)) },
    });
  };

  const welcomeVisible = messages.length === 0 && !loading;
  const role = currentUser ? getPrimaryRole(currentUser) : null;
  const isReader = role === 'CUSTOMER';

  // Record codes in answers link to the record; staff need the borrow pages to follow them.
  const recordList = (kind: RecordKind) => (kind === 'loan'
    ? (isReader ? '/customer/loans' : '/borrow/loans')
    : (isReader ? '/customer/reservations' : '/borrow/reservations'));
  const records: RecordLinks | undefined = isReader || canAccess(currentUser, ROUTE_ACCESS.borrowRead)
    ? {
        href: recordList,
        open: (kind, code) => {
          const list = recordList(kind);
          if (kind !== 'loan') {
            navigate(list);
            return;
          }
          const lookup: Promise<Array<{ id: string; loan_number?: string }> | undefined> = isReader
            ? customerBorrowService.getMyLoans({ pageSize: 100 }).then((r) => r?.data)
            : borrowService.getLoans({ q: code, pageSize: 5 }).then((r) => r?.data);
          lookup
            .then((rows) => {
              const hit = rows?.find((loan) => loan.loan_number === code);
              navigate(hit ? `${list}/${hit.id}` : list);
            })
            .catch(() => navigate(list));
        },
      }
    : undefined;
  // Readers get the answer only: the evidence trail and source names are for staff.
  const showEvidence = role !== null && role !== 'CUSTOMER';
  // gatherSystemContext is a no-op for these roles (the backend reads their own data).
  const usesFallbackContext = !role || !['CUSTOMER', 'WAREHOUSE_STAFF', 'SUPPLIER'].includes(role);
  const assistantLabel = caps
    ? EXPERIENCE_LABEL[caps.experience] ?? 'Trợ lý'
    : role === 'CUSTOMER' ? EXPERIENCE_LABEL.reader : 'Trợ lý';
  const busy = loading || streaming;

  // The composer grows with its text up to about six lines, then scrolls.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input, open, expanded]);

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const askedQuestions = messages.filter((m) => m.role === 'user').map((m) => m.text);
  const questionBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i -= 1) if (messages[i].role === 'user') return messages[i].text;
    return '';
  };

  const iconButton = 'grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 focus-visible:outline-2 focus-visible:outline-ring';
  const column = expanded ? 'mx-auto w-full max-w-[640px]' : 'w-full';
  const panelSize = expanded
    ? 'h-[min(820px,calc(100dvh-10rem))] w-[min(720px,calc(100vw-2rem))] max-sm:fixed max-sm:inset-0 max-sm:z-[60] max-sm:h-dvh max-sm:w-full max-sm:rounded-none'
    : 'h-[620px] max-h-[calc(100dvh-10rem)] w-[400px] max-w-[calc(100vw-2rem)]';

  return (
    <div className={`fixed right-4 z-50 flex flex-col items-end gap-3 ${aboveBottomNav ? 'bottom-20 lg:bottom-4' : 'bottom-4'}`}>
      {open && (
        <section
          aria-label="Trợ lý SmartBook AI"
          className={cn(
            'flex flex-col overflow-hidden rounded-[22px] bg-card text-card-foreground shadow-2xl shadow-foreground/15 ring-1 ring-foreground/[0.07] selection:bg-primary/15 animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none dark:ring-foreground/10',
            panelSize,
          )}
        >
          {/* Header */}
          <header className="flex shrink-0 items-center gap-2.5 border-b border-border/70 py-2.5 pl-3.5 pr-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-brand-ink dark:ring-1 dark:ring-brand-mist/20">
              <SmartBookAiMark tone="tile" busy={busy} className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[16px] font-semibold leading-5 text-foreground">SmartBook AI</h2>
              <p className="truncate text-[12px] leading-4 text-muted-foreground" aria-live="polite">
                {busy ? 'Đang tra cứu…' : contextReady ? assistantLabel : 'Đang nạp dữ liệu tổng quan…'}
              </p>
            </div>
            {usesFallbackContext && (
              <button type="button" onClick={() => void refreshContext()} className={iconButton}
                title="Nạp fallback context" aria-label="Nạp dữ liệu tổng quan cho AI">
                <Database className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
              className={cn(iconButton, view === 'history' && 'bg-muted text-foreground')}
              aria-pressed={view === 'history'} aria-label="Lịch sử trò chuyện" title="Lịch sử trò chuyện">
              <History className="h-4 w-4" aria-hidden="true" />
            </button>
            {(messages.length > 0 || view === 'history') && (
              <button type="button" onClick={handleReset} className={iconButton}
                title="Làm mới phiên chat" aria-label="Bắt đầu cuộc trò chuyện mới">
                <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={() => setExpanded((v) => !v)} className={iconButton}
              aria-pressed={expanded} aria-label={expanded ? 'Thu nhỏ khung chat' : 'Phóng to khung chat'}
              title={expanded ? 'Thu nhỏ' : 'Phóng to'}>
              {expanded ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={iconButton} aria-label="Đóng trợ lý">
              <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </header>

          {/* Conversation, or the saved conversations */}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={handleScroll}
            className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-5 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
            {view === 'history' ? (
              <div className={column}>
                <div className="px-1">
                  <h3 className="font-display text-[20px] font-medium leading-7 text-foreground">Lịch sử trò chuyện</h3>
                  <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
                    Lưu trên trình duyệt này cho tài khoản của bạn, tối đa 20 cuộc gần nhất.
                  </p>
                </div>
                {store.conversations.length === 0 ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[13.5px] leading-6 text-muted-foreground">
                    Chưa có cuộc trò chuyện nào. Câu hỏi bạn gửi sẽ được lưu ở đây.
                  </p>
                ) : (
                  <ul className="mt-4 overflow-hidden rounded-2xl border border-border">
                    {store.conversations.map((c) => {
                      const current = c.id === store.activeId;
                      return (
                        <li key={c.id} className="group/row flex items-stretch border-b border-border last:border-b-0">
                          <button type="button" onClick={() => openConversation(c.id)} aria-current={current ? 'true' : undefined}
                            className={cn('min-w-0 flex-1 cursor-pointer px-4 py-3 text-left transition-colors hover:bg-muted/60 active:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                              current && 'bg-primary/[0.06]')}>
                            <span className="line-clamp-2 text-[14px] leading-5 text-foreground">{c.title}</span>
                            <span className="mt-1 flex items-center gap-2 text-[12px] leading-4 text-muted-foreground">
                              <span>{updatedLabel(c.updatedAt)}</span>
                              <span aria-hidden="true">/</span>
                              <span>{c.messages.length} tin nhắn</span>
                              {current && <span className="font-medium text-primary">Đang mở</span>}
                            </span>
                          </button>
                          <button type="button" onClick={() => deleteConversation(c.id)}
                            aria-label={`Xóa cuộc trò chuyện: ${c.title}`} title="Xóa"
                            className="grid w-11 shrink-0 cursor-pointer place-items-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
            <div className={column}>
              {welcomeVisible && (
                <div className="flex flex-col gap-6">
                  <div className="px-1">
                    <p className="text-balance font-display text-[26px] font-medium leading-[1.15] tracking-[-0.015em] text-foreground">
                      {getWelcomeGreeting(currentUser)},<br />hôm nay bạn cần tìm gì?
                    </p>
                    <p className="mt-2.5 text-[14px] leading-6 text-muted-foreground">
                      {getWelcomeIntro(role, !!caps?.multimodal.enabled)}
                    </p>
                  </div>
                  {readerAccount && (
                    <ReaderDigest snapshot={snapshot} onAsk={(q) => void sendMessage(q)} disabled={loading} />
                  )}
                  {showSuggestions && (() => {
                    const starters = caps?.starter_questions;
                    const suggestions = getPageSuggestions(window.location.pathname, currentUser, starters) ?? [];
                    const fallback = starters && starters.length > 0 ? starters : getRoleSuggestions(currentUser);
                    const isPageSpecific = suggestions[0] !== fallback[0];
                    return (
                      <div>
                        <p className="mb-2 px-1 text-[12.5px] font-medium text-muted-foreground">
                          {isPageSpecific ? 'Gợi ý cho trang này' : 'Bạn có thể hỏi'}
                        </p>
                        <ul className="overflow-hidden rounded-2xl border border-border">
                          {suggestions.map((s) => {
                            const Icon = suggestionIcon(s);
                            return (
                              <li key={s} className="border-b border-border last:border-b-0">
                                <button
                                  type="button"
                                  onClick={() => void sendMessage(s)}
                                  disabled={loading}
                                  className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-[14px] leading-5 text-foreground transition-colors hover:bg-muted/60 active:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                                  <span className="flex-1">{s}</span>
                                  <ArrowRight className="h-4 w-4 shrink-0 -translate-x-1 text-primary opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none" aria-hidden="true" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="space-y-6">
                {messages.map((msg, index) => msg.role === 'user' ? (
                  <div key={msg.id} className="ml-auto w-fit max-w-[85%] animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
                    <div className="rounded-[18px] rounded-br-md bg-muted px-3.5 py-2 text-foreground">
                      {msg.hasPhoto && (
                        <span className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                          Kèm ảnh bìa sách
                        </span>
                      )}
                      <ChatMarkdown text={msg.text} />
                    </div>
                    {messageTime(msg.at) && (
                      <time dateTime={new Date(msg.at!).toISOString()} className="mt-1 block pr-1 text-right text-[11px] leading-4 text-muted-foreground">
                        {messageTime(msg.at)}
                      </time>
                    )}
                  </div>
                ) : (
                  <div key={msg.id} className="flex gap-3 animate-in fade-in duration-300 motion-reduce:animate-none">
                    <SmartBookAiMark className="-mt-1 h-7 w-7 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
                      <div className={cn('flex w-full gap-2', msg.failed ? 'text-muted-foreground' : 'text-foreground')}>
                        {msg.failed && <AlertTriangle className="mt-[5px] h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />}
                        <div className="min-w-0 flex-1">
                        <ChatMarkdown text={msg.text} records={records} onNavigate={navigate}
                          caret={streaming && streamingMsgId.current === msg.id} />
                        </div>
                      </div>
                      {msg.stopped && msg.text !== 'Đã dừng trả lời.' && <p className="text-[12px] text-muted-foreground">Đã dừng trả lời.</p>}

                      {msg.recognition && (
                        <BookRecognitionCard recognition={msg.recognition} chosenBookId={msg.chosenBookId}
                          onChoose={(c) => chooseCandidate(msg.id, msg.recognition!, c)}
                          onRetake={() => attachButtonRef.current?.click()} />
                      )}

                      {showEvidence && !msg.recognition && <EvidencePanel explainability={msg.explainability} />}

                      {msg.pending_action && (
                        <div className="w-full">
                          <ActionCard
                            action={msg.pending_action}
                            onConfirmed={handleActionConfirmed}
                            onCancelled={handleActionCancelled}
                          />
                        </div>
                      )}

                      {msg.action_result?.report_markdown && <ReportResult markdown={msg.action_result.report_markdown} />}

                      {msg.retrieval_warnings && msg.retrieval_warnings.length > 0 && (
                        <ul className="w-full space-y-1">
                          {msg.retrieval_warnings.slice(0, 2).map((w, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[12px] leading-5 text-amber-800 dark:text-amber-300">
                              <AlertTriangle className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}

                      {showEvidence && msg.context_sources && msg.context_sources.length > 0 && (() => {
                        const okSources = msg.context_sources
                          .filter((s: any) => s.status === 'ok')
                          .map((s: any) => s.name as string);
                        return okSources.length > 0 ? (
                          <p className="text-[12px] text-muted-foreground">Nguồn: {okSources.join(', ')}</p>
                        ) : null;
                      })()}

                      {(() => {
                        // Only the latest answer offers actions and follow-ups: older ones may be out of date.
                        if (msg.id !== lastAssistantId || busy || msg.failed || msg.stopped) return null;
                        const question = questionBefore(index);
                        return (
                          <>
                            {readerAccount && (
                              <ReaderActions snapshot={snapshot} text={msg.text} onNavigate={navigate}
                                aboutFines={msg.intent === 'FINE_SUMMARY_QUERY' || /phạt/i.test(question)} />
                            )}
                            {!msg.pending_action && !msg.recognition && !(msg.suggestions?.length) && (() => {
                              const next = followUpsFor({ reader: readerAccount, intent: msg.intent, question, asked: askedQuestions });
                              return next.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5" aria-label="Hỏi tiếp">
                                  {next.map((s) => (
                                    <button key={s} type="button" onClick={() => void sendMessage(s)}
                                      className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-left text-[13px] leading-5 text-foreground transition-colors hover:border-primary/40 hover:text-primary active:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                                      {s}
                                    </button>
                                  ))}
                                </div>
                              ) : null;
                            })()}
                          </>
                        );
                      })()}

                      {!(streaming && streamingMsgId.current === msg.id) && (
                        <div className="-ml-1.5 flex items-center gap-1">
                          {(msg.failed || msg.stopped) && msg.id === lastAssistantId && !busy && !messages[index - 1]?.hasPhoto && (
                            <button type="button" onClick={() => retryAnswer(msg.id)}
                              className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 active:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring">
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              Thử lại
                            </button>
                          )}
                          {!msg.recognition && !msg.stopped && !msg.failed && <CopyAnswer text={msg.text} />}
                          {messageTime(msg.at) && (
                            <time dateTime={new Date(msg.at!).toISOString()} className="px-1.5 text-[11px] leading-4 text-muted-foreground">
                              {messageTime(msg.at)}
                            </time>
                          )}
                        </div>
                      )}

                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {msg.suggestions.map((s) => (
                            <button key={s} type="button" onClick={() => void sendMessage(s)} disabled={busy}
                              className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-left text-[13px] leading-5 text-foreground transition-colors hover:border-primary/40 hover:text-primary active:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Looking things up: the shape of the answer that is coming */}
                {loading && (
                  <div className="flex gap-3" role="status">
                    <SmartBookAiMark busy className="-mt-1 h-7 w-7 shrink-0" />
                    <div className="flex-1 pt-0.5">
                      <p className="text-[13px] leading-5 text-muted-foreground">
                        {photo.phase === 'working' && photo.stage ? STAGE_LABEL[photo.stage] : 'Đang tra cứu dữ liệu…'}
                      </p>
                      <div className="mt-2.5 space-y-2" aria-hidden="true">
                        {['w-[92%]', 'w-[76%]', 'w-[54%]'].map((w) => (
                          <div key={w} className={cn('h-2.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none', w)} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div ref={bottomRef} />
            </div>
            )}
          </div>
          {view === 'chat' && awayFromBottom && (
            <button type="button" onClick={scrollToLatest}
              className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background shadow-md shadow-foreground/20 transition-opacity hover:opacity-90 active:opacity-80 animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none focus-visible:outline-2 focus-visible:outline-ring">
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              Tin mới nhất
            </button>
          )}
          </div>

          {/* Fallback context summary (staff only: the only roles that load it) */}
          {contextReady && systemContext?.summary && (
            <p className="shrink-0 border-t border-border bg-muted/40 px-4 py-1.5 text-[12px] tabular-nums text-muted-foreground">
              {systemContext.summary.totalBooks} đầu sách, {systemContext.summary.activeLoans} đang mượn
              {systemContext.summary.overdueLoans > 0 && (
                <>, <span className="font-medium text-destructive">{systemContext.summary.overdueLoans} quá hạn</span></>
              )}
            </p>
          )}

          {activeImage?.title && !photo.file && (
            <div className={cn('mt-2 flex items-center gap-2 self-center rounded-xl bg-muted px-2.5 py-1 text-[12px] text-foreground', expanded ? 'w-[calc(100%-1.5rem)] max-w-[640px]' : 'mx-3 self-stretch')}>
              <Camera className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">Đang hỏi về: <strong className="font-semibold">{activeImage.title}</strong></span>
              <button type="button" onClick={() => setActiveImage(null)} aria-label="Ngừng hỏi về sách trong ảnh"
                className="ml-auto grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          <PhotoPreview photo={photo} onReplace={() => attachButtonRef.current?.click()}
            onRetry={() => void runPhoto(lastPhotoQuestion.current || DEFAULT_PHOTO_QUESTION)} />

          {/* Composer */}
          <div className={cn('shrink-0 px-3 pb-2.5 pt-2', view === 'history' && 'hidden')}>
            <div className={column}>
              <div className="rounded-2xl border border-input bg-background transition-[border-color,box-shadow] duration-200 focus-within:border-primary/50 focus-within:shadow-md focus-within:shadow-primary/10">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // isComposing: Enter that commits a Vietnamese IME syllable must not send.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void sendMessage(input);
                    }
                  }}
                  placeholder={photo.file ? 'Hỏi về sách trong ảnh, hoặc để trống để nhận diện…' : speech.listening ? 'Hãy nói câu hỏi của bạn…' : 'Hỏi SmartBook AI…'}
                  aria-label="Câu hỏi cho trợ lý AI"
                  disabled={loading}
                  className="block max-h-[160px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[14px] leading-6 text-foreground caret-primary placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                />
                <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
                  <div className="flex items-center gap-0.5">
                    {caps?.multimodal.enabled && (
                      <PhotoAttachButton photo={photo} maxBytes={caps.multimodal.max_bytes} notice={caps.multimodal.notice}
                        disabled={busy} buttonRef={attachButtonRef} className="h-8 w-8" />
                    )}
                    {speech.supported && (
                      <button type="button" onClick={toggleSpeech} disabled={loading}
                        aria-pressed={speech.listening}
                        aria-label={speech.listening ? 'Dừng nói' : 'Nói câu hỏi'}
                        title={speech.listening ? 'Dừng nói' : 'Nói câu hỏi (trình duyệt chuyển giọng nói thành chữ)'}
                        className={cn('relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40',
                          speech.listening ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                        {speech.listening && (
                          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-lg bg-primary/15 motion-reduce:animate-none" />
                        )}
                        <Mic className="relative h-[18px] w-[18px]" aria-hidden="true" />
                      </button>
                    )}
                    {speech.listening && (
                      <span className="pl-1 text-[12px] text-primary" aria-live="polite">Đang nghe…</span>
                    )}
                  </div>
                  {streaming ? (
                    <button type="button" onClick={stopReply} aria-label="Dừng trả lời" title="Dừng trả lời"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none">
                      <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                    </button>
                  ) : (
                    <button type="button" onClick={() => void sendMessage(input)}
                      disabled={(!input.trim() && !photo.file) || loading} aria-label="Gửi"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground transition-[transform,opacity] hover:bg-primary/90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none">
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">
                SmartBook AI có thể nhầm. Hãy kiểm tra lại thông tin quan trọng.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Floating toggle; hidden on phones while the expanded panel fills the screen */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Đóng chatbot AI' : unread ? 'Mở chatbot AI, có câu trả lời mới' : 'Mở chatbot AI'}
        aria-expanded={open}
        className={cn(
          'relative grid h-14 w-14 cursor-pointer place-items-center rounded-full bg-brand-ink text-brand-lamp shadow-lg shadow-brand-ink/35 transition-transform dark:ring-1 dark:ring-brand-mist/25 duration-200 hover:-translate-y-0.5 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
          open && expanded && 'max-sm:hidden',
        )}
      >
        <SmartBookAiMark tone="tile" className={cn('absolute h-10 w-10 transition-[opacity,transform] duration-200 motion-reduce:transition-none', open ? 'rotate-[-30deg] scale-75 opacity-0' : 'opacity-100')} />
        <X className={cn('absolute h-[22px] w-[22px] transition-[opacity,transform] duration-200 motion-reduce:transition-none', open ? 'opacity-100' : 'rotate-[30deg] scale-75 opacity-0')} aria-hidden="true" />
        {unread && !open && (
          <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-brand-lamp ring-[3px] ring-background animate-in zoom-in duration-200 motion-reduce:animate-none" />
        )}
      </button>
    </div>
  );
}
