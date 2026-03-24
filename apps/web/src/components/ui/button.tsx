import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "./utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 active:scale-[0.98]",
        outline:
          "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 active:scale-[0.98]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50 active:scale-[0.98]",
        link: "text-primary underline-offset-4 hover:underline",
        "default-outline":
          "border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 active:scale-[0.98]",
        "success-outline":
          "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:scale-[0.98]",
        "danger-outline":
          "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-[0.98]",
        "warning-outline":
          "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 active:scale-[0.98]",
        "info-outline":
          "border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 active:scale-[0.98]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 text-[13px]",
        lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
        icon: "size-9 rounded-lg",
        "sm-icon": "size-8 rounded-md",
        "lg-icon": "size-10 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Show a loading spinner and disable interactions */
  loading?: boolean;
  /** Accessible label for loading state (for icon-only buttons) */
  loadingLabel?: string;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingLabel,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled || loading;

  return (
    <Comp
      data-slot="button"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={loading}
      aria-label={loading && loadingLabel ? loadingLabel : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" />
          {children && <span>{children}</span>}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

/** Icon-only button with proper accessibility */
function IconButton({
  className,
  variant,
  size = "icon",
  children,
  label,
  loading = false,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={props.disabled}
      loading={loading}
      loadingLabel={loading ? label : undefined}
      aria-label={label}
      {...props}
    >
      {children}
    </Button>
  );
}

export { Button, IconButton, buttonVariants };
