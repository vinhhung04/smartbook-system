import type { ReactNode } from "react";
import type { AuthPortal } from "@/components/auth/use-login-form";
import { StaffAuthShell } from "@/components/auth/staff-auth-shell";
import { CustomerAuthShell } from "@/components/auth/customer-auth-shell";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Which portal's look and voice to use; the internal one unless told otherwise. */
  portal?: AuthPortal;
}

/**
 * Frame for every sign-in page (login, register, forgot and reset password).
 * Staff pages get the workspace shell, reader pages the reading-room shell;
 * both share the same form parts (components/auth/auth-fields).
 */
export function AuthLayout({ portal = "staff", ...props }: AuthLayoutProps) {
  return portal === "customer" ? <CustomerAuthShell {...props} /> : <StaffAuthShell {...props} />;
}
