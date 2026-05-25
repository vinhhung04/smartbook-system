import { NavLink, useSearchParams } from "react-router";
import { ShieldAlert, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { authService } from "@/services/auth";
import { getHomePathForUser, getPrimaryRole } from "@/lib/rbac";

export function ForbiddenPage() {
  const [params] = useSearchParams();
  const user = authService.getCurrentUser();
  const homePath = getHomePathForUser(user);
  const from = params.get("from") || "this page";

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-xl rounded-xl border-border/70 shadow-sm">
        <CardContent className="p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-rose-600">Access denied</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">You do not have permission</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Current role: <span className="font-semibold text-foreground">{getPrimaryRole(user)}</span>. The route
                <span className="font-mono text-foreground"> {from}</span> is outside your assigned SmartBook workspace.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild>
                  <NavLink to={homePath}>
                    <Home className="h-4 w-4" />
                    Go to my home
                  </NavLink>
                </Button>
                <Button variant="outline" type="button" onClick={() => window.history.back()}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
