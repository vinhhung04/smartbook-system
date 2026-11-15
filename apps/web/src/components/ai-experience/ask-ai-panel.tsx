import { useId } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { askChatbot } from '@/lib/chatbot-bus';
import { canAccess, ROUTE_ACCESS } from '@/lib/rbac';
import { authService } from '@/services/auth';
import { cn } from '@/components/ui/utils';
import { SmartBookAiMark } from './smartbook-icons';

// "Hỏi SmartBook AI" on a detail page: a few questions about the object on the
// page. The chip shows a short label; the chatbot receives the full question,
// naming the book or the loan, and answers in the floating panel (managers:
// on /ai-assistant, which has no floating panel).

export interface AskAiQuestion {
  label: string;
  prompt: string;
}

export function AskAiPanel({ questions, className }: { questions: AskAiQuestion[]; className?: string }) {
  const titleId = useId();
  const navigate = useNavigate();
  // Managers have the full assistant page instead of the floating chatbot.
  const fullPage = canAccess(authService.getCurrentUser(), ROUTE_ACCESS.aiAssistant);
  const ask = (prompt: string) => {
    if (askChatbot(prompt, { send: true })) return;
    if (fullPage) {
      navigate('/ai-assistant', { state: { prompt, send: true } });
      return;
    }
    toast.info('Trợ lý AI chưa sẵn sàng, hãy thử lại sau giây lát.');
  };
  return (
    <section aria-labelledby={titleId} className={cn('rounded-2xl border border-border bg-card p-5', className)}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-brand-ink dark:ring-1 dark:ring-brand-mist/20">
          <SmartBookAiMark tone="tile" className="h-8 w-8" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-[17px] font-semibold leading-6 tracking-tight text-foreground">Hỏi SmartBook AI</h2>
          <p className="text-[12.5px] leading-5 text-muted-foreground">{fullPage ? 'Câu hỏi mở trong trang Trợ lý AI, ở một hội thoại mới.' : 'Câu trả lời hiện trong khung chat ở góc màn hình.'}</p>
        </div>
      </div>
      <ul className="mt-3.5 flex flex-wrap gap-2">
        {questions.map((q) => (
          <li key={q.label}>
            <button type="button" onClick={() => ask(q.prompt)} title={q.prompt}
              className="cursor-pointer rounded-full border border-border px-3.5 py-1.5 text-left text-[13px] font-medium leading-5 text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary active:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring">
              {q.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
