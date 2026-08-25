import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  Bot,
  Clock,
  MessageCircle,
  MessagesSquare,
  Package,
  Pencil,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
  Warehouse,
  Wrench,
} from 'lucide-react';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PriorityBadge } from '@/components/ui/priority-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  aiService,
  type AiConversationSummary,
  type AiEvidenceItem,
  type AssistantToolCall,
  type PendingAction,
} from '@/services/ai';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';
import { ActionCard } from '@/components/ai-action-card';
import { AIActionCenter } from '@/components/ai-action-center';

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: AssistantToolCall[];
  data?: Record<string, unknown>;
  pendingAction?: PendingAction;
  evidence?: AiEvidenceItem[];
  groundingWarning?: string | null;
  retrievalWarnings?: string[];
  isError?: boolean;
}

const ACTIVE_CONVERSATION_STORAGE_KEY = 'smartbook:ai-assistant:active-conversation-id';

const SUGGESTED_QUESTIONS = [
  { icon: Warehouse, text: 'Kho nào đang có rủi ro tồn kho thấp nhất?' },
  { icon: Package, text: 'Sách nào cần nhập thêm gấp trong 30 ngày tới?' },
  { icon: Clock, text: 'Có bao nhiêu phiếu mượn đang quá hạn và tổng tiền phạt chưa thu là bao nhiêu?' },
  { icon: TrendingUp, text: 'Tỷ lệ chuyển đổi reservation sang mượn sách hiện tại ra sao?' },
];

// Real answers take 60-120s+ on this deployment's CPU-only Ollama (each tool-calling round
// re-processes the full system prompt + tool schema set). A single static "loading" message
// reads as frozen well before that; these stages set honest expectations as time passes.
const LOADING_STAGES = [
  { atSeconds: 0, label: 'Đang phân tích câu hỏi...' },
  { atSeconds: 8, label: 'Đang chọn công cụ phân tích phù hợp...' },
  { atSeconds: 30, label: 'Đang tra cứu dữ liệu từ hệ thống...' },
  { atSeconds: 60, label: 'Đang tổng hợp câu trả lời (có thể mất đến ~2 phút)...' },
];

const PRIORITY_VALUES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

/** The assistant's system prompt asks it to bold key figures with **text** — render that
 * instead of showing literal asterisks. Intentionally bold-only (no headings/lists): that's
 * the only markdown construct the prompt actually asks the model to use. */
function renderMessageLine(line: string, key: number) {
  const parts = line.split(/\*\*(.*?)\*\*/g);
  return (
    <span key={key}>
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
}

function MessageText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, idx) => (
        <span key={idx}>
          {renderMessageLine(line, idx)}
          {idx < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === 'object' && !Array.isArray(item))
  );
}

function formatColumnLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPlainValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return value.toLocaleString('vi-VN');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderCell(column: string, value: unknown) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (column.toLowerCase() === 'priority' && typeof value === 'string' && PRIORITY_VALUES.has(value.toUpperCase())) {
    return <PriorityBadge priority={value} />;
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums">{value.toLocaleString('vi-VN')}</span>;
  }
  return formatPlainValue(value);
}

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  ).slice(0, 8);
  const numericColumns = new Set(columns.filter((col) => typeof rows[0]?.[col] === 'number'));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className={`whitespace-nowrap px-3 py-2 font-medium text-muted-foreground ${
                  numericColumns.has(col) ? 'text-right' : 'text-left'
                }`}
              >
                {formatColumnLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row, idx) => (
            <tr key={idx} className="border-t border-border transition-colors hover:bg-muted/30">
              {columns.map((col) => (
                <td
                  key={col}
                  className={`whitespace-nowrap px-3 py-2 text-foreground ${numericColumns.has(col) ? 'text-right' : ''}`}
                >
                  {renderCell(col, row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          ... và {rows.length - 20} dòng khác
        </p>
      )}
    </div>
  );
}

function KeyValueGrid({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).filter(([, value]) => value === null || typeof value !== 'object');
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{formatColumnLabel(key)}</div>
          <div className="text-[13px] font-medium tabular-nums text-foreground">{formatPlainValue(value)}</div>
        </div>
      ))}
    </div>
  );
}

function ToolResultBlock({ result }: { result: unknown }) {
  if (result === null || result === undefined) return null;

  if (typeof result === 'object' && !Array.isArray(result) && 'error' in (result as Record<string, unknown>)) {
    return (
      <p className="flex items-start gap-1.5 text-[12px] text-rose-600 dark:text-rose-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {String((result as Record<string, unknown>).error)}
      </p>
    );
  }

  if (isRowArray(result)) {
    return <DataTable rows={result} />;
  }

  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (isRowArray(record.items)) {
      return <DataTable rows={record.items as Record<string, unknown>[]} />;
    }
    return <KeyValueGrid obj={record} />;
  }

  return <p className="text-[13px] text-foreground">{String(result)}</p>;
}

function newConversationId() {
  return crypto.randomUUID();
}

export function AIAssistantPage() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [conversationId, setConversationId] = useState<string>(newConversationId);
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [hydrating, setHydrating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversations = async () => {
    try {
      const { items } = await aiService.listConversations();
      setConversations(items);
    } catch {
      // Non-critical — the sidebar just stays empty, doesn't block the chat itself.
    }
  };

  const hydrateConversation = async (id: string) => {
    setHydrating(true);
    try {
      const { messages: records } = await aiService.getConversationDetail(id);
      const base: AssistantMessage[] = records.map((record) => ({
        role: record.role === 'user' ? 'user' : 'assistant',
        content: record.content ?? '',
        toolsUsed: record.tool_calls ?? undefined,
        data: record.data ?? undefined,
        groundingWarning: record.grounding_warning ?? undefined,
      }));
      setMessages(base);
      setConversationId(id);
      localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);

      // ai_messages only stores the pending_action_id — fetch each referenced action's
      // current status lazily so a reopened conversation still shows live action cards.
      const actionEntries = await Promise.all(
        records.map(async (record, idx) => {
          if (!record.pending_action_id) return null;
          try {
            const action = await aiService.getPendingAction(record.pending_action_id);
            return [idx, action] as const;
          } catch {
            return null;
          }
        }),
      );
      setMessages((prev) => {
        const next = [...prev];
        for (const entry of actionEntries) {
          if (entry) {
            const [idx, action] = entry;
            if (next[idx]) next[idx] = { ...next[idx], pendingAction: action };
          }
        }
        return next;
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được hội thoại.'));
    } finally {
      setHydrating(false);
    }
  };

  useEffect(() => {
    loadConversations();
    const storedId = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    if (storedId) {
      hydrateConversation(storedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [loading]);

  const currentStage = [...LOADING_STAGES].reverse().find((stage) => elapsedSeconds >= stage.atSeconds) ?? LOADING_STAGES[0];

  const updateLastMessage = (updater: (message: AssistantMessage) => AssistantMessage) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = updater(next[next.length - 1]);
      return next;
    });
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    // Placeholder assistant message is filled in-place as tokens stream in — this IS the
    // "is the assistant working" indicator, no separate loading bubble needed once text starts.
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);
    try {
      await aiService.askAssistantStream(trimmed, conversationId, {
        onToken: (token) => updateLastMessage((message) => ({ ...message, content: message.content + token })),
        onDone: (response) => {
          updateLastMessage(() => ({
            role: 'assistant',
            content: response.answer,
            toolsUsed: response.tools_used,
            data: response.data,
            pendingAction: response.pending_action ?? undefined,
            evidence: response.evidence,
            groundingWarning: response.grounding_warning,
            retrievalWarnings: response.retrieval_warnings,
          }));
          const finalConversationId = response.conversation_id || conversationId;
          setConversationId(finalConversationId);
          localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, finalConversationId);
          loadConversations();
        },
        onError: (error) => {
          toast.error(getApiErrorMessage(error, 'Không thể gửi câu hỏi tới trợ lý AI'));
          updateLastMessage(() => ({
            role: 'assistant',
            content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi của bạn. Vui lòng thử lại.',
            isError: true,
          }));
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleActionConfirmed = (_actionId: string, result: any) => {
    const createdReqs: any[] = result?.created_requests ?? [];
    const skippedItems: string[] = result?.skipped_items ?? [];
    const noWhItems: string[] = result?.no_warehouse_items ?? [];

    let requestLine = '';
    if (createdReqs.length > 0) {
      const byWh: Record<string, { wh: string; prs: string[] }> = {};
      for (const r of createdReqs) {
        const key = r.warehouse_name || 'Chưa rõ kho';
        if (!byWh[key]) byWh[key] = { wh: key, prs: [] };
        if (r.request_number) byWh[key].prs.push(r.request_number);
      }
      requestLine = Object.values(byWh)
        .map((g) => `${g.wh}: ${g.prs.join(', ')}`)
        .join('\n');
    }
    const skippedLine = skippedItems.length > 0 ? `Bỏ qua (thiếu variant_id): ${skippedItems.join(', ')}` : '';
    const noWhLine = noWhItems.length > 0 ? `Bỏ qua (thiếu kho): ${noWhItems.join(', ')}` : '';

    const content = ['✅ Đã xác nhận hành động.', requestLine, skippedLine, noWhLine].filter(Boolean).join('\n');
    setMessages((prev) => [...prev, { role: 'assistant', content: content || '✅ Đã xác nhận hành động.' }]);
  };

  const handleActionCancelled = () => {
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Đã hủy hành động.' }]);
  };

  const startNewConversation = () => {
    setMessages([]);
    setInput('');
    setConversationId(newConversationId());
    localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
  };

  const switchConversation = (id: string) => {
    if (id === conversationId || loading || hydrating) return;
    setInput('');
    hydrateConversation(id);
  };

  const handleRenameConversation = async (id: string, currentTitle: string | null) => {
    const nextTitle = window.prompt('Đổi tên hội thoại', currentTitle ?? '');
    if (!nextTitle || !nextTitle.trim()) return;
    try {
      await aiService.renameConversation(id, nextTitle.trim());
      loadConversations();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không thể đổi tên hội thoại.'));
    }
  };

  return (
    <PageWrapper>
      <FadeItem className="space-y-6">
        <PageHeader
          icon={MessageCircle}
          title="Trợ lý AI"
          description="Đặt câu hỏi bằng tiếng Việt về tình trạng vận hành thư viện/kho — trợ lý sẽ tra cứu dữ liệu thật và đưa ra khuyến nghị có dẫn chứng số liệu."
          iconBg="bg-gradient-to-br from-indigo-500 to-violet-500"
          iconColor="text-white"
        />

        <Tabs defaultValue="chat">
          <TabsList>
            <TabsTrigger value="chat">
              <MessagesSquare className="h-3.5 w-3.5" />
              Hội thoại
            </TabsTrigger>
            <TabsTrigger value="actions">
              <ShieldAlert className="h-3.5 w-3.5" />
              Trung tâm hành động AI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat">
        <SectionCard
          title="Hội thoại"
          subtitle="Hội thoại được lưu để tiếp tục phân tích sau"
          noPadding
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startNewConversation}
              disabled={loading}
              title="Bắt đầu cuộc trò chuyện mới"
              className="active:scale-95 transition-transform"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Trò chuyện mới
            </Button>
          }
        >
          <div className="flex">
          <aside className="hidden w-56 shrink-0 flex-col divide-y divide-border border-r border-border md:flex">
            {conversations.length === 0 ? (
              <p className="px-4 py-4 text-[12px] text-muted-foreground">Chưa có hội thoại nào.</p>
            ) : (
              <div className="max-h-[65vh] min-h-[420px] overflow-y-auto">
                {conversations.map((conv) => (
                  <div
                    key={conv.conversation_id}
                    onClick={() => switchConversation(conv.conversation_id)}
                    className={`group flex cursor-pointer items-start gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                      conv.conversation_id === conversationId ? 'bg-muted/70' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-foreground">
                        {conv.title || 'Hội thoại chưa đặt tên'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {conv.last_message_at ? new Date(conv.last_message_at).toLocaleString('vi-VN') : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRenameConversation(conv.conversation_id, conv.title);
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                      title="Đổi tên hội thoại"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
          <div className="min-w-0 flex-1">
          <div ref={scrollRef} className="max-h-[65vh] min-h-[420px] space-y-6 overflow-y-auto px-5 py-6">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 opacity-40 blur-xl" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/25">
                    <Sparkles className="h-7 w-7 text-white" />
                  </div>
                </div>
                <div>
                  <h3 className="text-[18px] font-semibold text-foreground">Chưa có câu hỏi nào</h3>
                  <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
                    Thử hỏi về tồn kho thấp, sách quá hạn, gợi ý nhập hàng, hoặc phễu reservation.
                  </p>
                </div>
                <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  {SUGGESTED_QUESTIONS.map(({ icon: Icon, text }, index) => (
                    <motion.button
                      key={text}
                      type="button"
                      onClick={() => sendMessage(text)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-violet-300 hover:shadow-md dark:hover:border-violet-500/30"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/15">
                        <Icon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="text-[13px] leading-snug text-foreground">{text}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((message, idx) => {
                  const isStreamingMessage = loading && idx === messages.length - 1 && message.role === 'assistant';
                  const isAwaitingFirstToken = isStreamingMessage && message.content === '';

                  const isUser = message.role === 'user';

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm">
                          {isStreamingMessage && (
                            <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-40" />
                          )}
                          <Bot className="relative h-4 w-4 text-white" />
                        </div>
                      )}
                      <div className={isUser ? 'max-w-[80%] space-y-2' : 'min-w-0 flex-1 space-y-3'}>
                        <div
                          className={`whitespace-pre-wrap text-[14px] leading-relaxed ${
                            isUser
                              ? 'rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-2.5 text-white'
                              : message.isError
                                ? 'rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400'
                                : 'text-foreground'
                          }`}
                          aria-live={isStreamingMessage ? 'polite' : undefined}
                          role={isStreamingMessage ? 'status' : undefined}
                        >
                          {isAwaitingFirstToken ? (
                            <span className="inline-flex items-center gap-2 text-muted-foreground">
                              <span className="flex gap-1">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.3s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.15s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
                              </span>
                              <motion.span
                                key={currentStage.label}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                                className="text-[12px]"
                              >
                                {currentStage.label}
                              </motion.span>
                              <span className="tabular-nums text-[12px] text-muted-foreground/60">· {elapsedSeconds}s</span>
                            </span>
                          ) : (
                            <>
                              {message.isError && <AlertTriangle className="mr-1.5 inline-block h-3.5 w-3.5 -translate-y-px" />}
                              {isUser ? message.content : <MessageText text={message.content} />}
                              {isStreamingMessage && (
                                <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current" />
                              )}
                            </>
                          )}
                        </div>
                        {message.toolsUsed && message.toolsUsed.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {message.toolsUsed.map((call, callIdx) => (
                              <motion.span
                                key={callIdx}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: callIdx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                                className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                              >
                                {call.name}
                              </motion.span>
                            ))}
                          </div>
                        )}
                        {message.pendingAction && (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <ActionCard
                              action={message.pendingAction}
                              onConfirmed={handleActionConfirmed}
                              onCancelled={handleActionCancelled}
                            />
                          </motion.div>
                        )}
                        {(message.groundingWarning ||
                          (message.retrievalWarnings && message.retrievalWarnings.length > 0)) && (
                          <Alert className="border-amber-300 bg-amber-50 text-amber-800 [&>svg]:text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:[&>svg]:text-amber-400">
                            <AlertTriangle />
                            <AlertDescription className="text-amber-800 dark:text-amber-400">
                              {message.groundingWarning ||
                                'Một số số liệu trong câu trả lời chưa khớp hoàn toàn với dữ liệu tool. Vui lòng kiểm tra dữ liệu gốc bên dưới.'}
                              {message.retrievalWarnings && message.retrievalWarnings.length > 0 && (
                                <ul className="mt-1 list-disc pl-4">
                                  {message.retrievalWarnings.map((warning, i) => (
                                    <li key={i}>{warning}</li>
                                  ))}
                                </ul>
                              )}
                            </AlertDescription>
                          </Alert>
                        )}

                        {((message.evidence && message.evidence.length > 0) ||
                          (message.toolsUsed && message.toolsUsed.length > 0) ||
                          (message.data && Object.keys(message.data).length > 0)) && (
                          <Accordion type="multiple" className="rounded-xl border border-border">
                            {message.evidence && message.evidence.length > 0 && (
                              <AccordionItem value="evidence" className="px-3">
                                <AccordionTrigger className="text-[12px]">
                                  Bằng chứng AI đã dùng ({message.evidence.length})
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {message.evidence.map((item, i) => (
                                      <div key={i} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                          {item.label}
                                        </div>
                                        <div className="text-[13px] font-medium tabular-nums text-foreground">
                                          {formatPlainValue(item.value)}
                                          {item.unit ? ` ${item.unit}` : ''}
                                        </div>
                                        {item.description && (
                                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                                            {item.description}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            )}
                            {message.toolsUsed && message.toolsUsed.length > 0 && (
                              <AccordionItem value="tools" className="px-3">
                                <AccordionTrigger className="text-[12px]">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Wrench className="h-3 w-3" />
                                    Công cụ đã gọi ({message.toolsUsed.length})
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent>
                                  <div className="space-y-1.5">
                                    {message.toolsUsed.map((call, i) => (
                                      <div key={i} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                                        <p className="text-[12px] font-medium text-foreground">{call.name}</p>
                                        <pre className="mt-0.5 overflow-x-auto text-[11px] text-muted-foreground">
                                          {JSON.stringify(call.arguments, null, 2)}
                                        </pre>
                                      </div>
                                    ))}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            )}
                            {message.data && Object.keys(message.data).length > 0 && (
                              <AccordionItem value="data" className="px-3">
                                <AccordionTrigger className="text-[12px]">Dữ liệu gốc</AccordionTrigger>
                                <AccordionContent>
                                  <div className="space-y-3">
                                    {Object.entries(message.data).map(([toolName, result]) => (
                                      <div key={toolName} className="space-y-1">
                                        <p className="text-[11px] font-medium text-muted-foreground">{toolName}</p>
                                        <ToolResultBlock result={result} />
                                      </div>
                                    ))}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            )}
                          </Accordion>
                        )}
                      </div>
                      {isUser && (
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-500/15">
                          <User className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>

          <div className="border-t border-border px-5 py-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
              className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm transition-shadow focus-within:border-violet-300 focus-within:shadow-md dark:focus-within:border-violet-500/40"
            >
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder="Hỏi về tồn kho, quá hạn, gợi ý nhập hàng..."
                aria-label="Câu hỏi cho trợ lý AI"
                className="max-h-32 min-h-[40px] resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
                disabled={loading}
              />
              <Button
                type="submit"
                disabled={loading || !input.trim()}
                size="icon"
                aria-label="Gửi câu hỏi"
                className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white transition-transform hover:opacity-90 active:scale-95"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
          </div>
          </div>
        </SectionCard>
          </TabsContent>

          <TabsContent value="actions">
            <SectionCard
              title="Trung tâm hành động AI"
              subtitle="Lịch sử hành động AI đã đề xuất — xác nhận, hủy, và audit log đầy đủ"
              noPadding
            >
              <AIActionCenter />
            </SectionCard>
          </TabsContent>
        </Tabs>
      </FadeItem>
    </PageWrapper>
  );
}
