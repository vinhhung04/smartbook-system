import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { MotionConfig } from 'motion/react';
import { ArrowDown, History, MessagesSquare, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { aiService, type AiConversationSummary } from '@/services/ai';
import { authService, type AuthUser } from '@/services/auth';
import { formatDataAsOf } from '@/lib/copilot-visualization';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';
import { AIActionCenter } from '@/components/ai-action-center';
import type { AiActionListItem } from '@/services/ai';
import { useAIActionRealtime } from '@/hooks/useAIActionRealtime';
import { cn } from '@/components/ui/utils';
import { extrasToMessageFields, suggestionGroupsFor, type AssistantMessage } from '@/components/ai-assistant/model';
import { ConversationSidebar, type ConversationsStatus } from '@/components/ai-assistant/conversation-sidebar';
import { AssistantEmptyState } from '@/components/ai-assistant/assistant-empty-state';
import { AssistantComposer } from '@/components/ai-assistant/assistant-composer';
import { MessageItem, type StreamPhase } from '@/components/ai-assistant/assistant-message';
import { useStickToBottom } from '@/components/ai-assistant/use-stick-to-bottom';
import {
  abandonRun, attachPage, getRun, isRunning, markRunSeen, startRun, stopRun, subscribeRun, type RunStatus,
} from '@/components/ai-assistant/assistant-run';
import { aiExperienceService, AiHttpError, type AiCapabilities, type BookRecognition, type RecognitionCandidate, type TurnImage } from '@/services/ai-experience';
import { usePhotoAttachment } from '@/components/ai-experience/use-photo-attachment';
import { PhotoAttachButton, PhotoPreview } from '@/components/ai-experience/photo-composer';

const DEFAULT_PHOTO_QUESTION = 'Đây là sách gì? Tình hình tồn kho và lượt mượn của sách này thế nào?';

// /ai-assistant - a decision workspace: conversation history on the left
// (drawer below xl), the conversation in the centre, and the AI Action Center
// as a second view of the same workspace. Answers stream through
// askAssistantStream; everything they show comes from the backend response.

const ACTIVE_CONVERSATION_STORAGE_KEY = 'smartbook:ai-assistant:active-conversation-id';
const RAIL_STORAGE_KEY = 'smartbook:ai-assistant:history-rail';
const XL_QUERY = '(min-width: 1280px)';

function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function newConversationId() {
  return crypto.randomUUID();
}

export function AIAssistantPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Another page can hand over a question (router state); with `send` it is asked at once in a new conversation.
  const [handover] = useState(() => (location.state as { prompt?: string; send?: boolean } | null) ?? null);
  // An answer still being written (or finished while the page was closed) is shown again on return.
  const [resume] = useState(() => {
    const r = getRun();
    return r && !handover?.send && (r.status === 'running' || r.unseen) ? r : null;
  });
  const [currentUser] = useState<AuthUser | null>(() => authService.getCurrentUser());
  const suggestionGroups = suggestionGroupsFor(currentUser);
  const [messages, setMessages] = useState<AssistantMessage[]>(() => resume?.thread ?? []);
  const [input, setInput] = useState(() => (handover?.send ? '' : handover?.prompt ?? ''));
  const [loading, setLoading] = useState(() => resume?.status === 'running');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [conversationId, setConversationId] = useState<string>(() => resume?.conversationId ?? newConversationId());
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<ConversationsStatus>('loading');
  const [hydrating, setHydrating] = useState(false);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<{ id: string; title: string | null } | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string | null } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const [tab, setTab] = useState<'chat' | 'actions'>('chat');
  const [pendingActionCount, setPendingActionCount] = useState(0);
  const [briefing, setBriefing] = useState<AiActionListItem | null>(null);
  const [focusActionId, setFocusActionId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const messagesRef = useRef(messages);
  const pendingCountReloadTimerRef = useRef<number | null>(null);
  // Phase F: cover photo -> recognised book the next questions may refer to.
  const [caps, setCaps] = useState<AiCapabilities | null>(null);
  const photo = usePhotoAttachment();
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const [activeImage, setActiveImage] = useState<{ attachment_id: string; book_id?: string | null; title?: string | null } | null>(null);
  useEffect(() => {
    aiExperienceService.getCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);
  // The answer in flight lives in assistant-run.ts: leaving the page keeps it
  // going; "Dừng", a new conversation or another conversation drop it.
  useEffect(() => attachPage(), []);
  const { scrollRef, contentRef, atBottom, scrollToBottom } = useStickToBottom(messages.length > 0);

  const loadConversations = async () => {
    try {
      const { items } = await aiService.listConversations();
      setConversations(items);
      setConversationsStatus('ready');
    } catch {
      // Non-critical — the history shows a retry, the chat itself keeps working.
      setConversationsStatus('error');
    }
  };

  // Approximate, not a true live total — the API has no count endpoint, so this is
  // capped at 50 and shown as "50+" past that. Good enough to flag "something's
  // waiting" on the tab without opening it.
  const loadPendingActionCount = () => {
    aiService
      .listActions({ status: 'PENDING_CONFIRMATION', limit: 50 })
      .then((res) => {
        setPendingActionCount(res.items.length);
        // The nightly agent's report: a pending report draft that no person and no conversation created.
        setBriefing(res.items.find((a) => a.type === 'CREATE_REPORT_DRAFT' && !a.conversation_id && !a.created_by_user_id) ?? null);
      })
      .catch(() => {
        // Non-critical — the badge just stays at its last known count.
      });
  };

  useAIActionRealtime(() => {
    if (pendingCountReloadTimerRef.current) window.clearTimeout(pendingCountReloadTimerRef.current);
    pendingCountReloadTimerRef.current = window.setTimeout(loadPendingActionCount, 300);
  });

  useEffect(() => {
    return () => {
      if (pendingCountReloadTimerRef.current) window.clearTimeout(pendingCountReloadTimerRef.current);
    };
  }, []);

  const hydrateConversation = async (id: string) => {
    setHydrating(true);
    try {
      const { messages: records } = await aiService.getConversationDetail(id);
      const base: AssistantMessage[] = records.map((record) => ({
        role: record.role === 'user' ? 'user' : 'assistant',
        content: record.content ?? '',
        groundingWarning: record.grounding_warning ?? undefined,
        ...(record.role === 'user' ? {} : { ...extrasToMessageFields(record.extras), fromHistory: true }),
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

  const handedOver = useRef(false);
  useEffect(() => {
    loadConversations();
    loadPendingActionCount();
    if (resume) {
      if (resume.status !== 'running') markRunSeen();
      return;
    }
    if (handover?.send && handover.prompt) {
      if (handedOver.current) return;
      handedOver.current = true;
      // Asked once: a reload must not ask again.
      navigate(location.pathname, { replace: true, state: null });
      void sendMessage(handover.prompt);
      return;
    }
    const storedId = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    if (storedId) {
      hydrateConversation(storedId);
    }
  }, []);

  // Mirror the run into the thread on screen, and react when it ends.
  const runStatusRef = useRef<RunStatus | null>(resume?.status ?? null);
  useEffect(() => subscribeRun(() => {
    const r = getRun();
    if (!r) return;
    setMessages(r.thread);
    setLoading(r.status === 'running');
    const before = runStatusRef.current;
    runStatusRef.current = r.status;
    if (r.status === 'running') {
      if (before === 'running' && r.thread[r.thread.length - 1]?.content) setAnnouncement('Trợ lý đang soạn bản nháp câu trả lời.');
      return;
    }
    if (before !== 'running') return;
    if (r.status === 'done') {
      setAnnouncement('Trợ lý đã trả lời xong.');
      setConversationId(r.conversationId);
      loadConversations();
    } else if (r.status === 'error') {
      if (r.errorStatus === 410 || r.errorStatus === 400) setActiveImage(null);
      setAnnouncement('Có lỗi khi trả lời câu hỏi.');
    } else {
      setAnnouncement('Đã dừng câu trả lời.');
    }
  }), []);

  // A reopened conversation opens at its latest message.
  useEffect(() => {
    if (hydrating) scrollToBottom('auto');
  }, [hydrating, scrollToBottom]);

  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = getRun()?.startedAt ?? Date.now();
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [loading]);

  /** `base` is the thread to append to when the caller has just changed it (not yet rendered). */
  const sendMessage = async (text: string, image?: TurnImage, skipUser = false, base?: AssistantMessage[]) => {
    const trimmed = text.trim();
    if (!trimmed || isRunning() || hydrating) return;
    const turnImage = image ?? (activeImage ? { attachment_id: activeImage.attachment_id, book_id: activeImage.book_id } : undefined);
    const before = base ?? messagesRef.current;
    // The empty assistant message the run appends IS the "is the assistant working" indicator.
    const thread: AssistantMessage[] = skipUser ? before : [...before, { role: 'user', content: trimmed }];
    setInput((current) => (current.trim() === trimmed ? '' : current));
    setAnnouncement('Đã gửi câu hỏi. Đang chờ trợ lý trả lời.');
    runStatusRef.current = 'running';
    startRun({ question: trimmed, conversationId, image: turnImage, thread });
    scrollToBottom();
  };

  // The streamed text is an unverified draft, so a stopped answer is not kept;
  // marked as an error, the turn gets the usual "retry" affordance.
  const stopAnswer = useCallback(() => stopRun(), []);

  const askWithPhoto = async (question: string) => {
    if (isRunning() || hydrating) return;
    setMessages((prev) => [...prev, { role: 'user', content: question, hasPhoto: true }]);
    setInput('');
    setLoading(true);
    setAnnouncement('Đang phân tích ảnh bìa sách.');
    const rec = await photo.identify();
    setLoading(false);
    if (!rec) {
      setAnnouncement('Không phân tích được ảnh. Bạn có thể thử lại.');
      return;
    }
    photo.clear();
    const top = rec.candidates[0];
    const withRecognition: AssistantMessage[] = [...messagesRef.current, {
      role: 'assistant', content: rec.explanation.summary, recognition: rec, pendingQuestion: question,
      chosenBookId: rec.status === 'IDENTIFIED' ? top?.book_id : null,
    }];
    setMessages(withRecognition);
    setAnnouncement(rec.explanation.summary);
    if (rec.status === 'IDENTIFIED' && top) {
      setActiveImage({ attachment_id: rec.attachment_id, book_id: top.book_id, title: top.title });
      await sendMessage(question, { attachment_id: rec.attachment_id, book_id: top.book_id, image_turn: true }, true, withRecognition);
    } else {
      setActiveImage(null);
    }
  };

  const submit = async (text: string) => {
    if (photo.file) {
      await askWithPhoto(text.trim() || DEFAULT_PHOTO_QUESTION);
      return;
    }
    await sendMessage(text);
  };

  // Children are memoised; hand them stable callbacks that always run the latest closure.
  const sendRef = useRef(submit);
  const sendMessageRef = useRef(sendMessage);
  useLayoutEffect(() => {
    sendRef.current = submit;
    sendMessageRef.current = sendMessage;
    messagesRef.current = messages;
  });
  const ask = useCallback((text: string) => {
    void sendRef.current(text);
  }, []);

  const retryLast = useCallback(() => {
    const current = messagesRef.current;
    const question = current[current.length - 2];
    if (question?.role !== 'user' || !current[current.length - 1]?.isError || isRunning()) return;
    // Drop the failed exchange, then ask again: the resend appends it back.
    const base = current.slice(0, -2);
    setMessages(base);
    void sendMessageRef.current(question.content, undefined, false, base);
  }, []);

  const chooseRef = useRef<(rec: BookRecognition, c: RecognitionCandidate) => void>(() => {});
  chooseRef.current = (rec, candidate) => {
    if (isRunning()) return;
    const owner = messagesRef.current.find((m) => m.recognition?.attachment_id === rec.attachment_id);
    const base = messagesRef.current.map((m) => (m.recognition?.attachment_id === rec.attachment_id ? { ...m, chosenBookId: candidate.book_id } : m));
    setMessages(base);
    setActiveImage({ attachment_id: rec.attachment_id, book_id: candidate.book_id, title: candidate.title });
    void sendMessage(owner?.pendingQuestion || DEFAULT_PHOTO_QUESTION,
      { attachment_id: rec.attachment_id, book_id: candidate.book_id, image_turn: true }, true, base);
  };
  const chooseBook = useCallback((rec: BookRecognition, c: RecognitionCandidate) => chooseRef.current(rec, c), []);

  const handleActionConfirmed = useCallback((_actionId: string, result: unknown) => {
    const res = result as { created_requests?: Array<{ warehouse_name?: string; request_number?: string }>; skipped_items?: string[]; no_warehouse_items?: string[] } | null;
    const createdReqs = res?.created_requests ?? [];
    const skippedItems = res?.skipped_items ?? [];
    const noWhItems = res?.no_warehouse_items ?? [];

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
    const skippedLine = skippedItems.length > 0 ? `Bỏ qua vì chưa xác định được ấn bản sách: ${skippedItems.join(', ')}` : '';
    const noWhLine = noWhItems.length > 0 ? `Bỏ qua vì chưa chọn kho: ${noWhItems.join(', ')}` : '';

    const content = ['Đã xác nhận hành động.', requestLine, skippedLine, noWhLine].filter(Boolean).join('\n');
    setMessages((prev) => [...prev, { role: 'assistant', content: content || 'Đã xác nhận hành động.' }]);
  }, []);

  const handleActionCancelled = useCallback(() => {
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Đã hủy hành động.' }]);
  }, []);

  // The typed draft is kept across new/switched conversations: it is the
  // person's own text, and only sending it clears it.
  const startNewConversation = () => {
    abandonRun();
    runStatusRef.current = null;
    setLoading(false);
    setMessages([]);
    setConversationId(newConversationId());
    localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    setHistoryDrawerOpen(false);
  };

  const switchConversation = (id: string) => {
    setHistoryDrawerOpen(false);
    if (id === conversationId || loading || hydrating) return;
    hydrateConversation(id);
  };

  const openRenameDialog = (id: string, currentTitle: string | null) => {
    setRenameTarget({ id, title: currentTitle });
    setRenameValue(currentTitle ?? '');
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      setRenaming(true);
      await aiService.renameConversation(renameTarget.id, renameValue.trim());
      await loadConversations();
      setRenameTarget(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không thể đổi tên hội thoại.'));
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteConversation = (id: string, title: string | null) => {
    setPendingDeleteConversation({ id, title });
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;
    const { id } = pendingDeleteConversation;
    try {
      setDeletingConversation(true);
      await aiService.archiveConversation(id);
      setConversations((prev) => prev.filter((c) => c.conversation_id !== id));
      if (id === conversationId) {
        startNewConversation();
      }
      toast.success('Đã xóa hội thoại.');
      setPendingDeleteConversation(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không thể xóa hội thoại.'));
    } finally {
      setDeletingConversation(false);
    }
  };

  // The API archives one conversation per call and lists at most 50, so
  // "delete all" pages through the list in small batches until it is empty.
  // Same archive semantics as deleting one; proposed AI actions are untouched.
  const clearAllConversations = async () => {
    setClearingAll(true);
    let removed = 0;
    let failed = 0;
    try {
      for (let round = 0; round < 20; round += 1) {
        const { items } = await aiService.listConversations();
        if (items.length === 0) break;
        let progressed = false;
        for (let i = 0; i < items.length; i += 5) {
          const results = await Promise.allSettled(
            items.slice(i, i + 5).map((c) => aiService.archiveConversation(c.conversation_id)),
          );
          for (const r of results) {
            if (r.status === 'fulfilled') { removed += 1; progressed = true; } else failed += 1;
          }
        }
        if (!progressed) break;
      }
    } catch {
      // Listing failed mid-way: reported below with what was already removed.
      failed += 1;
    } finally {
      startNewConversation();
      await loadConversations();
      setClearingAll(false);
      setConfirmClearAll(false);
    }
    if (failed === 0) toast.success(removed > 0 ? `Đã xóa ${removed} hội thoại.` : 'Không còn hội thoại nào để xóa.');
    else if (removed > 0) toast.error(`Đã xóa ${removed} hội thoại; một số hội thoại chưa xóa được, vui lòng thử lại.`);
    else if (failed > 0) toast.error('Không xóa được lịch sử hội thoại, vui lòng thử lại.');
  };

  const setRail = (collapsed: boolean) => {
    setRailCollapsed(collapsed);
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? 'collapsed' : 'open');
    } catch {
      // Per-viewer convenience only.
    }
  };

  const openHistory = () => {
    if (window.matchMedia(XL_QUERY).matches) setRail(false);
    else setHistoryDrawerOpen(true);
  };

  const last = messages[messages.length - 1];
  const streamPhase: StreamPhase | null = loading && last?.role === 'assistant'
    ? last.verifying ? 'verifying' : last.content === '' ? 'waiting' : 'draft'
    : null;
  const activeConversation = conversations.find((c) => c.conversation_id === conversationId);
  const title = activeConversation ? activeConversation.title || 'Hội thoại chưa đặt tên' : 'Hội thoại mới';
  const subtitle = hydrating
    ? 'Đang mở hội thoại…'
    : loading
      ? 'Đang trả lời…'
      : activeConversation?.last_message_at
        ? `Cập nhật ${formatDataAsOf(activeConversation.last_message_at)}`
        : 'Câu hỏi đầu tiên sẽ tạo và lưu hội thoại';
  const busy = loading || hydrating;

  const sidebarProps = {
    conversations,
    status: conversationsStatus,
    activeId: conversationId,
    busy,
    onSelect: switchConversation,
    onNew: startNewConversation,
    onRename: openRenameDialog,
    onDelete: handleDeleteConversation,
    onRetry: () => {
      setConversationsStatus('loading');
      loadConversations();
    },
    onClearAll: () => {
      setHistoryDrawerOpen(false);
      setConfirmClearAll(true);
    },
  };

  return (
    <MotionConfig reducedMotion="user">
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'chat' | 'actions')} className="flex h-full min-h-0 flex-row gap-0">
        {tab === 'chat' && !railCollapsed && (
          <aside className="hidden w-[272px] shrink-0 border-r border-border bg-card xl:block">
            <ConversationSidebar {...sidebarProps} onCollapse={() => setRail(true)} />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-5">
            {tab === 'chat' && (
              <button type="button" onClick={openHistory} aria-label="Lịch sử hội thoại" title="Lịch sử hội thoại"
                className={cn('grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  !railCollapsed && 'xl:hidden')}>
                <History className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[17px] font-semibold leading-tight tracking-tight text-foreground" title={tab === 'chat' ? title : undefined}>
                {tab === 'chat' ? title : 'Trung tâm hành động AI'}
              </h1>
              <p className="hidden truncate text-[12px] text-muted-foreground sm:block">
                {tab === 'chat' ? subtitle : 'Đề xuất do trợ lý soạn, chờ bạn xác nhận, và lịch sử thực thi'}
              </p>
            </div>
            <TabsList className="h-9 shrink-0 rounded-lg">
              <TabsTrigger value="chat" className="rounded-md px-2.5 text-[13px]">
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Hội thoại</span>
                <span className="sr-only sm:hidden">Hội thoại</span>
              </TabsTrigger>
              <TabsTrigger value="actions" className="rounded-md px-2.5 text-[13px]">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Hành động AI</span>
                <span className="sr-only sm:hidden">Hành động AI</span>
                {pendingActionCount > 0 && (
                  <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground"
                    aria-label={`${pendingActionCount > 50 ? 'Hơn 50' : pendingActionCount} hành động chờ xác nhận`}>
                    {pendingActionCount > 50 ? '50+' : pendingActionCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            {tab === 'chat' && (
              <Button type="button" variant="outline" size="sm" onClick={startNewConversation} disabled={busy}
                title="Bắt đầu hội thoại mới" aria-label="Hội thoại mới" className={cn('h-9 shrink-0 px-2.5 sm:px-3', !railCollapsed && 'xl:hidden')}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="hidden md:inline">Hội thoại mới</span>
              </Button>
            )}
          </header>

          {/* Kept mounted while the Action Center is open: a streaming answer and the reading position survive the switch. */}
          <TabsContent value="chat" forceMount className="relative flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
            <div ref={scrollRef} data-assistant-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div ref={contentRef}
                className={cn('mx-auto flex w-full max-w-[50rem] 2xl:max-w-[56rem] flex-col px-5 pb-8 pt-6 sm:px-6', messages.length === 0 && 'min-h-full justify-center')}>
                {messages.length === 0 ? (
                  hydrating ? (
                    <div className="space-y-6 py-6" aria-label="Đang mở hội thoại">
                      {[0, 1].map((i) => (
                        <div key={i} className="space-y-3">
                          <span className="ml-auto block h-9 w-1/2 rounded-2xl bg-muted" />
                          <span className="block h-3 w-3/4 rounded bg-muted" />
                          <span className="block h-3 w-2/3 rounded bg-muted" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <AssistantEmptyState groups={suggestionGroups} onAsk={ask} disabled={busy}
                      briefing={briefing ? {
                        summary: briefing.summary,
                        createdAt: briefing.created_at,
                        onOpen: () => { setFocusActionId(briefing.id); setTab('actions'); },
                      } : null} />
                  )
                ) : (
                  <div className={cn('space-y-8 transition-opacity', hydrating && 'opacity-50')}>
                    {messages.map((message, idx) => {
                      const isLast = idx === messages.length - 1;
                      const phase = isLast && message.role === 'assistant' ? streamPhase : null;
                      return (
                        <MessageItem
                          key={idx}
                          message={message}
                          phase={phase}
                          elapsed={phase ? elapsedSeconds : 0}
                          isLast={isLast}
                          busy={busy}
                          onAsk={ask}
                          onRetry={retryLast}
                          onActionConfirmed={handleActionConfirmed}
                          onActionCancelled={handleActionCancelled}
                          onChooseBook={chooseBook}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="relative shrink-0 bg-background px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
              {!atBottom && messages.length > 0 && (
                <button type="button" onClick={() => scrollToBottom()}
                  className="absolute -top-11 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12.5px] font-medium text-foreground shadow-md transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring">
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  {loading ? 'Theo dõi câu trả lời' : 'Tin nhắn mới nhất'}
                </button>
              )}
              <div className="mx-auto max-w-[50rem] 2xl:max-w-[56rem]">
                <AssistantComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={ask}
                  sending={loading}
                  onStop={stopAnswer}
                  blocked={hydrating}
                  suggestions={messages.length > 0 ? suggestionGroups : undefined}
                  allowEmpty={Boolean(photo.file)}
                  attachSlot={caps?.multimodal.enabled ? (
                    <PhotoAttachButton photo={photo} maxBytes={caps.multimodal.max_bytes} notice={caps.multimodal.notice}
                      disabled={busy} buttonRef={attachButtonRef} />
                  ) : null}
                  previewSlot={(
                    <>
                      <PhotoPreview photo={photo} onReplace={() => attachButtonRef.current?.click()}
                        onRetry={() => void askWithPhoto(DEFAULT_PHOTO_QUESTION)} />
                      {activeImage?.title && !photo.file && (
                        <p className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-primary/5 px-2.5 py-1.5 text-[12.5px] text-foreground">
                          <span className="truncate">Câu hỏi tiếp theo có thể nói về sách trong ảnh: <strong>{activeImage.title}</strong></span>
                          <button type="button" onClick={() => setActiveImage(null)}
                            className="ml-auto shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                            Bỏ
                          </button>
                        </p>
                      )}
                    </>
                  )}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="actions" className="flex min-h-0 flex-1 flex-col">
            <AIActionCenter focusActionId={focusActionId} onOpenConversation={(id) => {
              if (isRunning()) {
                toast.info('Trợ lý đang trả lời câu hỏi hiện tại. Hãy mở hội thoại này sau khi xong.');
                return;
              }
              setTab('chat');
              switchConversation(id);
            }} />
          </TabsContent>
        </div>
      </Tabs>

      <Sheet open={historyDrawerOpen} onOpenChange={setHistoryDrawerOpen}>
        <SheetContent side="left" className="w-[min(20rem,88vw)] gap-0 p-0 [&>button:last-child]:hidden">
          <SheetTitle className="sr-only">Lịch sử hội thoại</SheetTitle>
          <SheetDescription className="sr-only">Chọn một hội thoại để mở lại, đổi tên hoặc xóa.</SheetDescription>
          <ConversationSidebar {...sidebarProps} onClose={() => setHistoryDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!pendingDeleteConversation}
        onOpenChange={(open) => { if (!open) setPendingDeleteConversation(null); }}
        title="Xóa hội thoại?"
        description={`Xóa hội thoại "${pendingDeleteConversation?.title || 'chưa đặt tên'}"? Hành động này không thể hoàn tác.`}
        variant="destructive"
        confirmLabel="Xóa"
        onConfirm={confirmDeleteConversation}
        loading={deletingConversation}
      />

      <ConfirmDialog
        open={confirmClearAll}
        onOpenChange={(open) => { if (!open && !clearingAll) setConfirmClearAll(false); }}
        title="Xóa toàn bộ lịch sử hội thoại?"
        description={`Tất cả ${conversations.length >= 50 ? '50+' : conversations.length} hội thoại của bạn sẽ bị xóa khỏi lịch sử. Hành động này không thể hoàn tác. Các hành động AI đã đề xuất vẫn được giữ trong Trung tâm hành động.`}
        variant="destructive"
        confirmLabel="Xóa tất cả"
        onConfirm={clearAllConversations}
        loading={clearingAll}
      />

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đổi tên hội thoại</DialogTitle>
            <DialogDescription>Tên giúp bạn tìm lại phân tích này trong lịch sử.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rename-conversation-input">Tên hội thoại</Label>
            <Input
              id="rename-conversation-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitRename();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)} disabled={renaming}>
              Hủy
            </Button>
            <Button type="button" onClick={submitRename} disabled={!renameValue.trim()} loading={renaming}>
              Lưu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MotionConfig>
  );
}
