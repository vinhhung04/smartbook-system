import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  Bot,
  Clock,
  MessageCircle,
  Package,
  RotateCcw,
  Send,
  Sparkles,
  TrendingUp,
  User,
  Warehouse,
} from 'lucide-react';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PriorityBadge } from '@/components/ui/priority-badge';
import { aiService, type AssistantToolCall, type PendingAction } from '@/services/ai';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';
import { ActionCard } from '@/components/ai-action-card';

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: AssistantToolCall[];
  data?: Record<string, unknown>;
  pendingAction?: PendingAction;
}

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
  const [conversationId, setConversationId] = useState(newConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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
          }));
        },
        onError: (error) => {
          toast.error(getApiErrorMessage(error, 'Không thể gửi câu hỏi tới trợ lý AI'));
          updateLastMessage(() => ({
            role: 'assistant',
            content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi của bạn. Vui lòng thử lại.',
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
  };

  return (
    <PageWrapper>
      <FadeItem className="space-y-6">
        <PageHeader
          icon={MessageCircle}
          title="Trợ lý AI"
          description="Đặt câu hỏi bằng tiếng Việt về tình trạng vận hành thư viện/kho — trợ lý sẽ tra cứu dữ liệu thật và đưa ra khuyến nghị có dẫn chứng số liệu."
          iconBg="bg-violet-100 dark:bg-violet-500/15"
          iconColor="text-violet-600 dark:text-violet-400"
        />

        <SectionCard
          title="Hội thoại"
          subtitle="Lịch sử chỉ được lưu trong phiên làm việc hiện tại"
          noPadding
          actions={
            messages.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startNewConversation}
                disabled={loading}
                title="Bắt đầu cuộc trò chuyện mới"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Trò chuyện mới
              </Button>
            ) : undefined
          }
        >
          <div ref={scrollRef} className="max-h-[60vh] min-h-[280px] space-y-4 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Chưa có câu hỏi nào"
                description="Thử hỏi về tồn kho thấp, sách quá hạn, gợi ý nhập hàng, hoặc phễu reservation."
                footer={
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {SUGGESTED_QUESTIONS.map(({ icon: Icon, text }) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => sendMessage(text)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[12px] text-foreground transition-colors hover:border-violet-300 hover:bg-violet-50 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10"
                      >
                        <Icon className="h-3.5 w-3.5 text-violet-500" />
                        {text}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((message, idx) => {
                  const isStreamingMessage = loading && idx === messages.length - 1 && message.role === 'assistant';
                  const isAwaitingFirstToken = isStreamingMessage && message.content === '';

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className={`flex gap-2.5 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {message.role === 'assistant' && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-500/15">
                          <Bot className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        </div>
                      )}
                      <div className="max-w-[85%] space-y-2">
                        <div
                          className={`whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
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
                              <span className="text-[12px]">{currentStage.label}</span>
                              <span className="tabular-nums text-[12px] text-muted-foreground/60">· {elapsedSeconds}s</span>
                            </span>
                          ) : (
                            <>
                              {message.role === 'assistant' ? <MessageText text={message.content} /> : message.content}
                              {isStreamingMessage && (
                                <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-current" />
                              )}
                            </>
                          )}
                        </div>
                        {message.toolsUsed && message.toolsUsed.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {message.toolsUsed.map((call, callIdx) => (
                              <span
                                key={callIdx}
                                className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                              >
                                {call.name}
                              </span>
                            ))}
                          </div>
                        )}
                        {message.pendingAction && (
                          <ActionCard
                            action={message.pendingAction}
                            onConfirmed={handleActionConfirmed}
                            onCancelled={handleActionCancelled}
                          />
                        )}
                        {message.data && Object.keys(message.data).length > 0 && (
                          <div className="space-y-3">
                            {Object.entries(message.data).map(([toolName, result]) => (
                              <div key={toolName} className="space-y-1">
                                <p className="text-[11px] font-medium text-muted-foreground">{toolName}</p>
                                <ToolResultBlock result={result} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {message.role === 'user' && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-500/15">
                          <User className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(input);
            }}
            className="flex items-end gap-2 border-t border-border px-5 py-4"
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
              className="max-h-32 min-h-[44px]"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()} size="icon" aria-label="Gửi câu hỏi">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
