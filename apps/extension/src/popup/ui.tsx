import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** Every button-shaped control in the popup. */
export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  block = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; pending?: boolean; block?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={["btn", `btn-${variant}`, `btn-${size}`, block ? "btn-block" : "", className].filter(Boolean).join(" ")}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function GearIcon() {
  return (
    <Icon>
      <path d="M6.9 1.7h2.2l.3 1.6 1.1.5 1.4-.9 1.6 1.6-.9 1.4.5 1.1 1.6.3v2.2l-1.6.3-.5 1.1.9 1.4-1.6 1.6-1.4-.9-1.1.5-.3 1.6H6.9l-.3-1.6-1.1-.5-1.4.9-1.6-1.6.9-1.4-.5-1.1-1.6-.3V6.9l1.6-.3.5-1.1-.9-1.4 1.6-1.6 1.4.9 1.1-.5z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  );
}

export function BackIcon() {
  return (
    <Icon>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </Icon>
  );
}

export function SyncIcon() {
  return (
    <Icon>
      <path d="M13 6.5A5 5 0 0 0 4 4.8M3 9.5a5 5 0 0 0 9 1.7" />
      <path d="M4 2.5v2.5h2.5M12 13.5V11H9.5" />
    </Icon>
  );
}

/** A labelled group of mutually exclusive options (custom control). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="segment"
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
