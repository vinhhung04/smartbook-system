import { NavLink } from "react-router";
import { BarChart3, BookMarked, ClipboardCheck, Package, Shield, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const dashboards = {
  admin: {
    title: "Admin Dashboard",
    subtitle: "Quan tri user, role, permission va audit he thong.",
    links: [
      { to: "/users", label: "Users", icon: Users },
      { to: "/roles", label: "Roles & Permissions", icon: Shield },
      { to: "/audit-trail", label: "Audit Trail", icon: ClipboardCheck },
    ],
  },
  manager: {
    title: "Manager Dashboard",
    subtitle: "Theo doi van hanh, bao cao, ton kho va phe duyet mua hang.",
    links: [
      { to: "/reports", label: "Reports", icon: BarChart3 },
      { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardCheck },
      { to: "/reorder-suggestions", label: "Reorder Suggestions", icon: Package },
    ],
  },
  librarian: {
    title: "Librarian Dashboard",
    subtitle: "Quan ly ban doc, reservation, loan, return va fine.",
    links: [
      { to: "/borrow", label: "Borrow Dashboard", icon: BookMarked },
      { to: "/borrow/customers", label: "Borrow Customers", icon: Users },
      { to: "/borrow/loans", label: "Loans", icon: ClipboardCheck },
    ],
  },
  staff: {
    title: "Staff Dashboard",
    subtitle: "Van hanh catalog, nhap kho, putaway, picking va outbound.",
    links: [
      { to: "/inventory", label: "Inventory", icon: Package },
      { to: "/orders", label: "Goods Receipts", icon: ClipboardCheck },
      { to: "/putaway", label: "Putaway", icon: Package },
    ],
  },
};

function ActorDashboard({ type }: { type: keyof typeof dashboards }) {
  const config = dashboards[type];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">{config.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{config.subtitle}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {config.links.map((link) => (
          <NavLink key={link.to} to={link.to}>
            <Card className="h-full rounded-lg transition-colors hover:border-primary/40 hover:bg-muted/30">
              <CardHeader className="space-y-0 pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <link.icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-sm font-medium">{link.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Mo chuc nang phu hop voi vai tro hien tai.
              </CardContent>
            </Card>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export function AdminDashboardPage() {
  return <ActorDashboard type="admin" />;
}

export function ManagerDashboardPage() {
  return <ActorDashboard type="manager" />;
}

export function LibrarianDashboardPage() {
  return <ActorDashboard type="librarian" />;
}

export function StaffDashboardPage() {
  return <ActorDashboard type="staff" />;
}
