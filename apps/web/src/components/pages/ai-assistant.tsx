import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, MessageCircle, Send, Sparkles, User } from 'lucide-react';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { aiService, type AssistantToolCall } from '@/services/ai';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: AssistantToolCall[];
  data?: Record<string, unknown>;
}

const SUGGESTED_QUESTIONS = [
  'Kho nào đang có rủi ro tồn kho thấp nhất?',
  'Sách nào cần nhập thêm gấp trong 30 ngày tới?',
  'Có bao nhiêu phiếu mượn đang quá hạn và tổng tiền phạt chưa thu là bao nhiêu?',
  'Tỷ lệ chuyển đổi reservation sang mượn sách hiện tại ra sao?',
];

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === 'object' && !Array.isArray(item))
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  ).slice(0, 8);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((col) => (
              <th key={col} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row, idx) => (
            <tr key={idx} className="border-t border-border">
              {columns.map((col) => (
                <td key={col} className="whitespace-nowrap px-3 py-2 text-foreground">
                  {formatCell(row[col])}
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
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{key}</div>
          <div className="text-[13px] font-medium text-foreground">{formatCell(value)}</div>
        </div>
      ))}
    </div>
  );
}

function ToolResultBlock({ result }: { result: unknown }) {
  if (result === null || result === undefined) return null;

  if (typeof result === 'object' && !Array.isArray(result) && 'error' in (result as Record<string, unknown>)) {
    return (
      <p className="text-[12px] text-rose-600 dark:text-rose-400">
        ⚠️ {String((result as Record<string, unknown>).error)}
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

export function AIAssistantPage() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId] = useState(() => crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setLoading(true);
    try {
      const response = await aiService.askAssistant(trimmed, conversationId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response.answer, toolsUsed: response.tools_used, data: response.data },
      ]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không thể gửi câu hỏi tới trợ lý AI'));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi của bạn. Vui lòng thử lại.' },
      ]);
    } finally {
      setLoading(false);
    }
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

        <SectionCard title="Hội thoại" subtitle="Lịch sử chỉ được lưu trong phiên làm việc hiện tại" noPadding>
          <div ref={scrollRef} className="max-h-[60vh] min-h-[280px] space-y-4 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Chưa có câu hỏi nào"
                description="Thử hỏi về tồn kho thấp, sách quá hạn, gợi ý nhập hàng, hoặc phễu reservation."
                footer={
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {SUGGESTED_QUESTIONS.map((question) => (
                      <button
                        key={question}
                        type="button"
                        onClick={() => sendMessage(question)}
                        className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-muted"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : (
              messages.map((message, idx) => (
                <div key={idx} className={`flex gap-2.5 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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
                    >
                      {message.content}
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
                </div>
              ))
            )}
            {loading && (
              <div className="flex items-center gap-2 pl-9 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Trợ lý đang tra cứu dữ liệu...
              </div>
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
              className="max-h-32 min-h-[44px]"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
