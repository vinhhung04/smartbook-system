import { useMemo } from 'react';
import { LogOut, ShieldCheck, User } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { authService } from '@/services/auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function getInitials(name?: string, username?: string) {
  const source = (name || username || 'U').trim();
  const words = source.split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() || '').join('') || 'U';
}

export function UserAvatarMenu() {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();

  const initials = useMemo(() => getInitials(user?.full_name, user?.username), [user?.full_name, user?.username]);

  const handleLogout = async () => {
    await authService.logout();
    toast.success('Đã đăng xuất');
    navigate('/customer/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-2 rounded-[11px] border border-slate-200 bg-white px-2 py-1.5 hover:bg-slate-50">
          <Avatar className="h-8 w-8 border border-indigo-200">
            <AvatarFallback className="bg-indigo-50 text-[12px] text-indigo-700">{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden text-left sm:block">
            <p className="text-[12px] text-slate-700" style={{ fontWeight: 600 }}>{user?.full_name || user?.username}</p>
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 rounded-[12px] border-slate-200 p-1.5">
        <div className="px-2 py-1.5">
          <p className="text-[12px] text-slate-900" style={{ fontWeight: 700 }}>{user?.full_name || user?.username}</p>
          <p className="text-[11px] text-slate-500">{user?.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/customer/profile')} className="rounded-[9px] text-[12px]">
          <User className="h-4 w-4" />
          Hồ sơ của tôi
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/customer/membership')} className="rounded-[9px] text-[12px]">
          <ShieldCheck className="h-4 w-4" />
          Hội viên
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleLogout()} className="rounded-[9px] text-[12px]" variant="destructive">
          <LogOut className="h-4 w-4" />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
