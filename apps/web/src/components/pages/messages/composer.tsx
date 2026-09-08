import { useRef, useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { IconButton } from '@/components/ui/button';

export function Composer({ onSend }: { onSend: (content: string) => void }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue('');
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <div className="flex items-end gap-2 px-4 py-3 border-t border-border bg-card">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Nhập tin nhắn... (Enter để gửi, Shift+Enter xuống dòng)"
        rows={1}
        className="flex-1 resize-none rounded-lg border border-input bg-input-background px-3 py-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring max-h-[120px]"
      />
      <IconButton
        label="Gửi tin nhắn"
        size="icon"
        disabled={!value.trim()}
        onClick={submit}
      >
        <Send className="w-4 h-4" />
      </IconButton>
    </div>
  );
}
