import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "icon" | "xs" | "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "border-accent/70 bg-accent text-accent-contrast shadow-card hover:border-accent hover:brightness-95 hover:shadow-card-hover",
  secondary:
    "border-border bg-surface text-fg shadow-card hover:border-accent/30 hover:bg-subtle",
  ghost:
    "border-transparent bg-transparent text-muted shadow-none hover:bg-subtle hover:text-fg",
  danger:
    "border-danger/35 bg-danger/10 text-danger shadow-none hover:border-danger/55 hover:bg-danger/15",
};

/** Controls use fixed heights so buttons, links, and fields line up across
 *  layouts. `icon` is square and reserved for glyph-only controls. */
const SIZE: Record<ButtonSize, string> = {
  icon: "h-8 w-8 gap-0 rounded-lg p-0 text-xs",
  xs: "h-7 gap-1 rounded-md px-2.5 text-[11px]",
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-lg px-4 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-sm",
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
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap border font-medium leading-none transition-[background-color,border-color,color,box-shadow,filter,transform] duration-150 active:translate-y-px active:scale-[0.98] disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-45 motion-reduce:transform-none",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button(
  {
    variant = "secondary",
    size = "md",
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    />
  );
});
