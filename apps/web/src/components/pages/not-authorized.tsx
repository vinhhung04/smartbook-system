import { ShieldAlert } from "lucide-react";
import { NavLink } from "react-router";
import { getDefaultRouteForUser } from "@/lib/rbac";

export function NotAuthorizedPage() {
  const defaultRoute = getDefaultRouteForUser();

  return (
    <div className="min-h-full flex items-center justify-center bg-background px-6 py-12">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">403 - Khong co quyen truy cap</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Tai khoan hien tai khong co role hoac permission phu hop de mo chuc nang nay.
        </p>
        <NavLink
          to={defaultRoute}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Ve trang cua toi
        </NavLink>
      </div>
    </div>
  );
}
