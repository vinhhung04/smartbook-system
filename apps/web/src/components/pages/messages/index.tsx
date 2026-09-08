import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { MessagesSquare } from 'lucide-react';
import { ConversationList } from './conversation-list';
import { ThreadPane } from './thread-pane';
import { NewConversationDialog } from './new-conversation-dialog';
import { useMessaging } from './use-messaging';

export function MessagesPage() {
  const {
    currentUserId,
    directory,
    staffById,
    conversations,
    messagesByConversation,
    typingByConversation,
    selectedId,
    selectConversation,
    sendMessage,
    createConversation,
  } = useMessaging();

  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="h-full flex overflow-hidden">
      <ConversationList
        conversations={conversations}
        staffById={staffById}
        currentUserId={currentUserId}
        selectedId={selectedId}
        onSelect={selectConversation}
        onNewConversation={() => setDialogOpen(true)}
      />

      {selectedConversation ? (
        <ThreadPane
          conversation={selectedConversation}
          messages={messagesByConversation[selectedConversation.id] ?? []}
          staffById={staffById}
          currentUserId={currentUserId}
          typingMemberIds={typingByConversation[selectedConversation.id] ?? []}
          onSend={(content) => sendMessage(selectedConversation.id, content)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={MessagesSquare}
            title="Chưa có hội thoại nào"
            description="Bắt đầu một cuộc trò chuyện mới với đồng nghiệp."
          />
        </div>
      )}

      <NewConversationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        directory={directory}
        currentUserId={currentUserId}
        onCreate={createConversation}
      />
    </div>
  );
}
