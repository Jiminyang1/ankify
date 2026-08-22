"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { MotionPresence } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg shadow-card transition placeholder:text-muted hover:border-accent/25 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "resize-y", className)} {...rest} />;
}

type SelectOption = {
  value: string;
  label: React.ReactNode;
  disabled: boolean;
};

function collectOptions(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      const fragmentProps = child.props as { children?: React.ReactNode };
      collectOptions(fragmentProps.children).forEach((option) => options.push(option));
      return;
    }
    if (child.type !== "option") return;

    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    options.push({
      value: String(props.value ?? ""),
      label: props.children,
      disabled: Boolean(props.disabled),
    });
  });

  return options;
}

export function Select({
  className,
  children,
  value,
  onValueChange,
  disabled = false,
  id,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onChange" | "value"> & {
  children: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const generatedId = useId();
  const selectId = id ?? `select-${generatedId}`;
  const listboxId = `${selectId}-listbox`;
  const options = useMemo(() => collectOptions(children), [children]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(selectedIndex, 0));
  const [openUpward, setOpenUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open, options, selectedIndex]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const openMenu = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
    const root = rootRef.current;
    if (root) {
      const rect = root.getBoundingClientRect();
      const estimatedMenuHeight = Math.min(options.length * 40 + 12, 288);
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < estimatedMenuHeight && rect.top > spaceBelow);
    }
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      openMenu();
      const indexes = options.map((_, index) => index).filter((index) => !options[index]?.disabled);
      setActiveIndex(event.key === "Home" ? (indexes[0] ?? -1) : (indexes.at(-1) ?? -1));
      return;
    }
    if (open && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={cn(
          FIELD_BASE,
          "flex cursor-pointer items-center justify-between gap-3 text-left",
          open && "border-accent/40 ring-2 ring-accent/30",
        )}
        {...rest}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? value}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted transition-transform duration-150",
            open && "rotate-180 text-accent",
          )}
          aria-hidden
        />
      </button>

      <MotionPresence
        show={open}
        side={openUpward ? "top" : "bottom"}
        id={listboxId}
        role="listbox"
        aria-labelledby={selectId}
        className={cn(
          "absolute left-0 z-50 max-h-72 min-w-full overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-card-hover",
          openUpward ? "bottom-[calc(100%+0.4rem)]" : "top-[calc(100%+0.4rem)]",
        )}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <button
              key={`${option.value}-${index}`}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              data-option-index={index}
              disabled={option.disabled}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-fg transition-colors",
                active && "bg-subtle",
                selected && "bg-accent-soft font-medium text-accent",
                option.disabled && "cursor-not-allowed opacity-45",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <Check
                className={cn("h-4 w-4 shrink-0 text-accent", !selected && "invisible")}
                aria-hidden
              />
            </button>
          );
        })}
      </MotionPresence>
    </div>
  );
}

/**
 * Labeled field wrapper. Renders an uppercase caption above the control and
 * associates it via the rendered <label>. Keep the control as the single child.
 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
