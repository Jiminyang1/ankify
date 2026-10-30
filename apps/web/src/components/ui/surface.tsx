import { cn } from "@/lib/utils";

export function Surface({
  children,
  className,
  hover,
  as: Component = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  as?: React.ElementType;
  [key: string]: unknown;
}) {
  return (
    <Component
      className={cn(
        "surface rounded-xl border border-border shadow-card transition",
        hover && "hover:shadow-card-hover hover:-translate-y-px",
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
