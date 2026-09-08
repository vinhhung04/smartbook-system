import { Component, type ReactNode } from 'react';
import { NavLink, useRouteError, isRouteErrorResponse } from 'react-router';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { authService } from '@/services/auth';
import { getHomePathForUser } from '@/lib/rbac';

interface RouteErrorBoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('RouteErrorBoundary caught a render error:', error, info);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <InlineErrorFallback onReload={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}

function InlineErrorFallback({ onReload }: { onReload: () => void }) {
  const user = authService.getCurrentUser();
  const homePath = getHomePathForUser(user);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg rounded-xl border-border/70 shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-rose-600 dark:text-rose-400">Đã xảy ra lỗi</p>
              <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground">Trang này không tải được</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Đã có lỗi khi hiển thị nội dung. Vui lòng tải lại trang; nếu lỗi vẫn tiếp diễn, hãy quay về trang chủ.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="button" onClick={onReload}>
                  <RotateCw className="h-4 w-4" />
                  Tải lại trang
                </Button>
                <Button asChild variant="outline">
                  <NavLink to={homePath}>
                    <Home className="h-4 w-4" />
                    Về trang chủ
                  </NavLink>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const user = authService.getCurrentUser();
  const homePath = getHomePathForUser(user);

  const description = isRouteErrorResponse(error)
    ? `Lỗi ${error.status}: ${error.statusText || 'Không thể tải trang này'}`
    : 'Đã có lỗi ngoài dự kiến khi tải trang. Vui lòng tải lại trang; nếu lỗi vẫn tiếp diễn, hãy quay về trang chủ.';

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-lg rounded-xl border-border/70 shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-rose-600 dark:text-rose-400">Đã xảy ra lỗi</p>
              <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground">Không thể tải ứng dụng</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="button" onClick={() => window.location.reload()}>
                  <RotateCw className="h-4 w-4" />
                  Tải lại trang
                </Button>
                <Button asChild variant="outline">
                  <NavLink to={homePath}>
                    <Home className="h-4 w-4" />
                    Về trang chủ
                  </NavLink>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
