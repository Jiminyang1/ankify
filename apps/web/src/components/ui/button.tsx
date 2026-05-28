import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-accent text-white shadow-card hover:opacity-90",
  secondary: "border border-border bg-surface text-fg hover:bg-subtle",
  ghost: "border border-transparent text-fg hover:bg-subtle",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-md px-3 py-1.5 text-xs",
  md: "gap-2 rounded-lg px-4 py-2 text-sm",
};

/**
 * Class string for a button-styled element. Use this when you need to style a
 * non-button element (e.g. a Next.js <Link>) like a button; otherwise prefer
 * the <Button> component below.
 */
export function buttonClasses({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "inline-flex select-none items-center justify-center font-medium transition disabled:pointer-events-none disabled:opacity-50",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...rest} />;
}
