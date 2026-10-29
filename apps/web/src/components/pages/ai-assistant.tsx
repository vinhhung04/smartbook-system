import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
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
import { useAIActionRealtime } from '@/hooks/useAIActionRealtime';
import { cn } from '@/components/ui/utils';
import { extrasToMessageFields, suggestionGroupsFor, type AssistantMessage } from '@/components/ai-assistant/model';
import { ConversationSidebar, type ConversationsStatus } from '@/components/ai-assistant/conversation-sidebar';
import { AssistantEmptyState } from '@/components/ai-assistant/assistant-empty-state';
import { AssistantComposer } from '@/components/ai-assistant/assistant-composer';
import { MessageItem, type StreamPhase } from '@/components/ai-assistant/assistant-message';
import { useStickToBottom } from '@/components/ai-assistant/use-stick-to-bottom';

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
  const [currentUser] = useState<AuthUser | null>(() => authService.getCurrentUser());
  const suggestionGroups = suggestionGroupsFor(currentUser);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  // Another page can hand over a question via router state; it is only pre-filled, never auto-sent.
  const [input, setInput] = useState(() => (location.state as { prompt?: string } | null)?.prompt ?? '');
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [conversationId, setConversationId] = useState<string>(newConversationId);
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
  const [announcement, setAnnouncement] = useState('');
  const pendingCountReloadTimerRef = useRef<number | null>(null);
  // Guards a second send fired before React re-renders with loading=true (double Enter/click).
  const inFlightRef = useRef(false);
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
      .then((res) => setPendingActionCount(res.items.length))
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

  useEffect(() => {
    loadConversations();
    loadPendingActionCount();
    const storedId = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    if (storedId) {
      hydrateConversation(storedId);
    }
  }, []);

  // A reopened conversation opens at its latest message.
  useEffect(() => {
    if (hydrating) scrollToBottom('auto');
  }, [hydrating, scrollToBottom]);

  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [loading]);

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
    if (!trimmed || inFlightRef.current || hydrating) return;
    inFlightRef.current = true;
    // Placeholder assistant message is filled in-place as tokens stream in — this IS the
    // "is the assistant working" indicator, no separate loading bubble needed once text starts.
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }]);
    setInput((current) => (current.trim() === trimmed ? '' : current));
    setLoading(true);
    setAnnouncement('Đã gửi câu hỏi. Đang chờ trợ lý trả lời.');
    scrollToBottom();
    let firstToken = true;
    try {
      await aiService.askAssistantStream(trimmed, conversationId, {
        onToken: (token) => {
          if (firstToken) {
            firstToken = false;
            setAnnouncement('Trợ lý đang soạn bản nháp câu trả lời.');
          }
          updateLastMessage((message) => ({ ...message, content: message.content + token }));
        },
        onStatus: (stage) => {
          if (stage === 'verifying') {
            updateLastMessage((message) => ({ ...message, verifying: true }));
            setAnnouncement('Đang đối chiếu câu trả lời với dữ liệu.');
          }
        },
        onDone: (response) => {
          updateLastMessage(() => ({
            role: 'assistant',
            content: response.answer,
            pendingAction: response.pending_action ?? undefined,
            evidence: response.evidence,
            groundingWarning: response.grounding_warning,
            retrievalWarnings: response.retrieval_warnings,
            ...extrasToMessageFields(response),
          }));
          setAnnouncement('Trợ lý đã trả lời xong.');
          const finalConversationId = response.conversation_id || conversationId;
          setConversationId(finalConversationId);
          localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, finalConversationId);
          loadConversations();
        },
        onError: (error) => {
          toast.error(getApiErrorMessage(error, 'Không thể gửi câu hỏi tới trợ lý AI'));
          setAnnouncement('Có lỗi khi trả lời câu hỏi.');
          updateLastMessage(() => ({
            role: 'assistant',
            content: 'Xin lỗi, đã có lỗi xảy ra khi xử lý câu hỏi của bạn. Vui lòng thử lại.',
            isError: true,
          }));
        },
      });
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  // Children are memoised; hand them stable callbacks that always run the latest closure.
  const sendRef = useRef(sendMessage);
  const messagesRef = useRef(messages);
  useLayoutEffect(() => {
    sendRef.current = sendMessage;
    messagesRef.current = messages;
  });
  const ask = useCallback((text: string) => {
    void sendRef.current(text);
  }, []);

  const retryLast = useCallback(() => {
    const current = messagesRef.current;
    const question = current[current.length - 2];
    if (question?.role !== 'user' || !current[current.length - 1]?.isError || inFlightRef.current) return;
    // Drop the failed exchange, then ask again: the resend appends it back.
    setMessages((prev) => prev.slice(0, -2));
    void sendRef.current(question.content);
  }, []);

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
    const skippedLine = skippedItems.length > 0 ? `Bỏ qua (thiếu variant_id): ${skippedItems.join(', ')}` : '';
    const noWhLine = noWhItems.length > 0 ? `Bỏ qua (thiếu kho): ${noWhItems.join(', ')}` : '';

    const content = ['✅ Đã xác nhận hành động.', requestLine, skippedLine, noWhLine].filter(Boolean).join('\n');
    setMessages((prev) => [...prev, { role: 'assistant', content: content || '✅ Đã xác nhận hành động.' }]);
  }, []);

  const handleActionCancelled = useCallback(() => {
    setMessages((prev) => [...prev, { role: 'assistant', content: 'Đã hủy hành động.' }]);
  }, []);

  // The typed draft is kept across new/switched conversations: it is the
  // person's own text, and only sending it clears it.
  const startNewConversation = () => {
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
          <aside className="hidden w-[272px] shrink-0 border-r border-border bg-card/50 xl:block">
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
              <p className="text-[11.5px] font-medium text-muted-foreground">Trợ lý AI</p>
              <h1 className="truncate text-[14.5px] font-semibold leading-tight text-foreground" title={tab === 'chat' ? title : undefined}>
                {tab === 'chat' ? title : 'Trung tâm hành động AI'}
              </h1>
            </div>
            {tab === 'chat' && (
              <span className="hidden max-w-[16rem] truncate text-[12px] text-muted-foreground lg:block">{subtitle}</span>
            )}
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
                  <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10.5px] font-semibold tabular-nums text-white"
                    aria-label={`${pendingActionCount > 50 ? 'Hơn 50' : pendingActionCount} hành động chờ xác nhận`}>
                    {pendingActionCount > 50 ? '50+' : pendingActionCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            {tab === 'chat' && (
              <Button type="button" variant="outline" size="sm" onClick={startNewConversation} disabled={busy}
                title="Bắt đầu hội thoại mới" aria-label="Hội thoại mới" className="h-9 shrink-0 px-2.5 sm:px-3">
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
                className={cn('mx-auto flex w-full max-w-[50rem] 2xl:max-w-[56rem] flex-col px-4 pb-8 pt-6 sm:px-6', messages.length === 0 && 'min-h-full justify-center')}>
                {messages.length === 0 ? (
                  hydrating ? (
                    <div className="space-y-6 py-6" aria-label="Đang mở hội thoại">
                      {[0, 1].map((i) => (
                        <div key={i} className="space-y-3">
                          <span className="ml-auto block h-9 w-1/2 animate-pulse rounded-2xl bg-muted" />
                          <span className="block h-3 w-3/4 animate-pulse rounded bg-muted" />
                          <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <AssistantEmptyState groups={suggestionGroups} onAsk={ask} disabled={busy} />
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
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="relative shrink-0 bg-gradient-to-t from-background via-background to-background/0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
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
                  blocked={hydrating}
                  suggestions={messages.length > 0 ? suggestionGroups : undefined}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="actions" className="flex min-h-0 flex-1 flex-col">
            <AIActionCenter />
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
