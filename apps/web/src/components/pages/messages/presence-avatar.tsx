import { motion } from 'motion/react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/components/ui/utils';
import { ROLE_META } from './role-meta';
import type { StaffMember } from './types';
import { initialsOf } from './utils';

const SIZE = {
  sm: { avatar: 'w-8 h-8', dot: 'w-2 h-2', text: 'text-[10px]' },
  md: { avatar: 'w-10 h-10', dot: 'w-2.5 h-2.5', text: 'text-[11px]' },
  lg: { avatar: 'w-12 h-12', dot: 'w-3 h-3', text: 'text-[13px]' },
};

// The signature element: a role-colored dot (identity — which department someone
// works in, reusing that role's home sidebar-group color) plus a pulse ring while
// online (liveness), reusing the same motion.span pulse idiom the topbar's
// notification badge already uses.
export function PresenceAvatar({ member, size = 'md' }: { member: StaffMember; size?: 'sm' | 'md' | 'lg' }) {
  const meta = ROLE_META[member.role];
  const dims = SIZE[size];

  return (
    <div className="relative shrink-0">
      {member.online && (
        <motion.span
          className="absolute -inset-0.5 rounded-full border-2 border-emerald-400"
          animate={{ opacity: [0.55, 0, 0.55], scale: [1, 1.18, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <Avatar className={dims.avatar}>
        <AvatarFallback className={cn(meta.bg, meta.text, dims.text)} style={{ fontWeight: 700 }}>
          {initialsOf(member.full_name)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card transition-opacity',
          dims.dot,
          meta.dot,
          !member.online && 'opacity-40',
        )}
        title={`${meta.label} · ${member.online ? 'Đang hoạt động' : 'Ngoại tuyến'}`}
      />
    </div>
  );
}
