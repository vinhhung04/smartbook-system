import { NavLink, isRouteErrorResponse, useRouteError } from "react-router";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function describeError(error: unknown): { title: string; detail: string } {
  if (isRouteErrorResponse(error)) {
    return {
      title: `Lỗi ${error.status}`,
      detail: error.statusText || "Đã xảy ra lỗi khi tải trang này.",
    };
  }
  if (error instanceof Error) {
    return { title: "Đã có lỗi xảy ra", detail: error.message };
  }
  return { title: "Đã có lỗi xảy ra", detail: "Vui lòng thử tải lại trang." };
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const { title, detail } = describeError(error);

  if (import.meta.env.DEV) {
    console.error("Route error boundary caught:", error);
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-xl rounded-xl border-border/70 shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-rose-600 dark:text-rose-400">
                Có sự cố
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground break-words">{detail}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild>
                  <NavLink to="/">
                    <Home className="h-4 w-4" />
                    Về trang chủ
                  </NavLink>
                </Button>
                <Button variant="outline" type="button" onClick={() => window.location.reload()}>
                  <RefreshCw className="h-4 w-4" />
                  Tải lại trang
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
