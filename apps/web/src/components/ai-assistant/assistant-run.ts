import { toast } from 'sonner';
import { aiService } from '@/services/ai';
import { AiHttpError, type TurnImage } from '@/services/ai-experience';
import { getApiErrorMessage } from '@/services/http-clients';
import { extrasToMessageFields, type AssistantMessage } from './model';

// The answer being written for /ai-assistant lives here, outside the page, so
// leaving the page does not cancel it: the request keeps streaming while the
// manager works elsewhere in the app, and a toast says when it is done. The
// page shows the run's thread whenever it is mounted. Closing or reloading the
// tab still ends the request: that would need the server to keep the job.

export type RunStatus = 'running' | 'done' | 'error' | 'stopped';

export interface AssistantRun {
  conversationId: string;
  question: string;
  /** The whole conversation as it stands, ending with the answer being written. */
  thread: AssistantMessage[];
  status: RunStatus;
  startedAt: number;
  /** The run ended while no page was showing it, and nobody has looked yet. */
  unseen: boolean;
  /** HTTP status of a failed request, for the page's photo handling. */
  errorStatus?: number;
}

const ACTIVE_CONVERSATION_STORAGE_KEY = 'smartbook:ai-assistant:active-conversation-id';
const STOPPED_TEXT = 'Đã dừng câu trả lời. Bản nháp chưa được đối chiếu với dữ liệu nên không được giữ lại.';
const FAILED_TEXT = 'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi của bạn. Vui lòng thử lại.';

let run: AssistantRun | null = null;
let controller: AbortController | null = null;
let pagesShowing = 0;
let navigate: ((to: string) => void) | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function update(change: Partial<AssistantRun>, last?: (message: AssistantMessage) => AssistantMessage) {
  if (!run) return;
  const thread = last ? [...run.thread.slice(0, -1), last(run.thread[run.thread.length - 1])] : run.thread;
  run = { ...run, ...change, thread };
  emit();
}

export const getRun = () => run;
export const isRunning = () => run?.status === 'running';

export function subscribeRun(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The page tells the store it is showing the thread (so no toast is needed). */
export function attachPage() {
  pagesShowing += 1;
  return () => { pagesShowing -= 1; };
}

/** The app shell registers its router so a toast can open the answer. */
export function registerAssistantNavigator(fn: (to: string) => void) {
  navigate = fn;
  return () => { if (navigate === fn) navigate = null; };
}

export function markRunSeen() {
  if (run?.unseen) {
    run = { ...run, unseen: false };
    emit();
  }
}

function openAnswer() {
  if (navigate) navigate('/ai-assistant');
  else window.location.assign('/ai-assistant');
}

function remember(conversationId: string) {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);
  } catch {
    // The run still shows; only reopening after a reload needs this.
  }
}

/** Starts an answer for `question`; `thread` already holds the question (and anything shown before it). */
export function startRun({ question, conversationId, image, thread }: {
  question: string;
  conversationId: string;
  image?: TurnImage;
  thread: AssistantMessage[];
}) {
  controller?.abort();
  const own = new AbortController();
  controller = own;
  run = {
    conversationId,
    question,
    thread: [...thread, { role: 'assistant', content: '' }],
    status: 'running',
    startedAt: Date.now(),
    unseen: false,
  };
  emit();
  const mine = () => controller === own;

  void aiService.askAssistantStream(question, conversationId, {
    signal: own.signal,
    image,
    onToken: (token) => {
      if (mine()) update({}, (m) => ({ ...m, content: m.content + token }));
    },
    onStatus: (stage) => {
      if (mine() && stage === 'verifying') update({}, (m) => ({ ...m, verifying: true }));
    },
    onDone: (response) => {
      if (!mine()) return;
      const finalId = response.conversation_id || conversationId;
      remember(finalId);
      const away = pagesShowing === 0;
      update({ status: 'done', conversationId: finalId, unseen: away }, () => ({
        role: 'assistant',
        content: response.answer,
        pendingAction: response.pending_action ?? undefined,
        evidence: response.evidence,
        groundingWarning: response.grounding_warning,
        retrievalWarnings: response.retrieval_warnings,
        explainability: response.explainability ?? null,
        ...extrasToMessageFields(response),
      }));
      if (away) {
        toast.success('Trợ lý AI đã trả lời xong', {
          description: question.length > 90 ? `${question.slice(0, 89)}…` : question,
          action: { label: 'Xem câu trả lời', onClick: openAnswer },
          duration: 15_000,
        });
      }
    },
    onError: (error) => {
      if (!mine()) return;
      const away = pagesShowing === 0;
      update(
        { status: 'error', unseen: away, errorStatus: error instanceof AiHttpError ? error.status : undefined },
        () => ({ role: 'assistant', content: FAILED_TEXT, isError: true }),
      );
      const message = error instanceof AiHttpError ? error.message : getApiErrorMessage(error, 'Không thể gửi câu hỏi tới trợ lý AI');
      if (away) toast.error('Trợ lý AI chưa trả lời được', { description: message, action: { label: 'Mở trợ lý', onClick: openAnswer } });
      else toast.error(message);
    },
  }).finally(() => {
    if (mine()) controller = null;
  });
}

/** "Dừng": the unverified draft is not kept; the turn gets the usual retry. */
export function stopRun() {
  if (!run || run.status !== 'running') return;
  controller?.abort();
  controller = null;
  update({ status: 'stopped' }, () => ({ role: 'assistant', content: STOPPED_TEXT, isError: true }));
}

/** A new or another conversation: the answer in flight is dropped. */
export function abandonRun() {
  controller?.abort();
  controller = null;
  run = null;
  emit();
}
