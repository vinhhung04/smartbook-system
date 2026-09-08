import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { PresenceAvatar } from './presence-avatar';
import { ROLE_META } from './role-meta';
import type { StaffMember } from './types';

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: StaffMember[];
  currentUserId: string;
  onCreate: (memberIds: string[], name?: string) => void;
}

export function NewConversationDialog({ open, onOpenChange, directory, currentUserId, onCreate }: NewConversationDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');

  const people = directory.filter((m) => m.id !== currentUserId);
  const isGroup = selected.length > 1;

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const reset = () => {
    setSelected([]);
    setGroupName('');
  };

  const handleCreate = () => {
    if (selected.length === 0) return;
    onCreate(selected, isGroup ? groupName || undefined : undefined);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hội thoại mới</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12px] text-slate-500">
            Chọn 1 người để nhắn trực tiếp, hoặc nhiều người để tạo nhóm.
          </p>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
            {people.map((member) => {
              const checked = selected.includes(member.id);
              return (
                <label
                  key={member.id}
                  className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(member.id)} />
                  <PresenceAvatar member={member} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] truncate" style={{ fontWeight: 550 }}>{member.full_name}</p>
                    <p className={`text-[11px] ${ROLE_META[member.role].text}`}>{ROLE_META[member.role].label}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {isGroup && (
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Tên nhóm (vd: Kho A — Ca sáng)"
              className="text-[13px]"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button disabled={selected.length === 0} onClick={handleCreate}>
            {isGroup ? 'Tạo nhóm' : 'Bắt đầu nhắn tin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
