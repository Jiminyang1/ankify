"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

const FALLBACK_TIME_ZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Pacific/Auckland",
] as const;

function browserTimeZones(currentValue: string) {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;

  let supported: string[] = [];
  try {
    supported = supportedValuesOf?.("timeZone") ?? [];
  } catch {
    supported = [];
  }

  return Array.from(
    new Set(["UTC", currentValue, ...supported, ...FALLBACK_TIME_ZONES].filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

export function TimeZonePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const hydrated = useHydrated();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [timeZones] = useState<string[]>(() => browserTimeZones(value));
  const detectedTimeZone = hydrated
    ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
    : "";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setFiltering(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const matchingTimeZones = useMemo(() => {
    if (!filtering) return timeZones;
    const query = value.trim().toLocaleLowerCase();
    if (!query) return timeZones;
    return timeZones.filter((zone) => zone.toLocaleLowerCase().includes(query));
  }, [filtering, timeZones, value]);
  const resolvedActiveIndex = Math.min(
    activeIndex,
    Math.max(0, matchingTimeZones.length - 1),
  );

  useEffect(() => {
    if (!open || matchingTimeZones.length === 0) return;
    document.getElementById(`${listId}-option-${resolvedActiveIndex}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [listId, matchingTimeZones.length, open, resolvedActiveIndex]);

  function openPicker() {
    setFiltering(false);
    setOpen(true);
    setActiveIndex(Math.max(0, timeZones.indexOf(value)));
  }

  function chooseTimeZone(timeZone: string) {
    onChange(timeZone);
    setFiltering(false);
    setOpen(false);
  }

  return (
    <div ref={rootRef}>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={
            open && matchingTimeZones.length > 0
              ? `${listId}-option-${resolvedActiveIndex}`
              : undefined
          }
          autoComplete="off"
          value={value}
          onFocus={openPicker}
          onChange={(event) => {
            onChange(event.target.value);
            setFiltering(true);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) {
                openPicker();
                return;
              }
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(0, matchingTimeZones.length - 1)),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                openPicker();
                return;
              }
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (
              event.key === "Enter" &&
              open &&
              matchingTimeZones[resolvedActiveIndex]
            ) {
              event.preventDefault();
              chooseTimeZone(matchingTimeZones[resolvedActiveIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setFiltering(false);
            } else if (event.key === "Tab") {
              setOpen(false);
              setFiltering(false);
            }
          }}
          placeholder="Asia/Shanghai"
        />

        {open && (
          <div
            id={listId}
            role="listbox"
            aria-label={t.settings.timeZoneOptions}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl"
          >
            {matchingTimeZones.length > 0 ? (
              matchingTimeZones.map((zone, index) => (
                <button
                  key={zone}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={zone === value}
                  tabIndex={-1}
                  className={cn(
                    "flex min-h-9 w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                    index === resolvedActiveIndex
                      ? "bg-accent-soft text-fg"
                      : "text-muted hover:bg-subtle hover:text-fg",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseTimeZone(zone)}
                >
                  <span>{zone}</span>
                  {zone === value && <span className="text-accent" aria-hidden="true">✓</span>}
                </button>
              ))
            ) : (
              <p className="px-3 py-4 text-center text-sm text-muted">
                {t.settings.noTimeZones}
              </p>
            )}
          </div>
        )}
      </div>

      {detectedTimeZone && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => chooseTimeZone(detectedTimeZone)}
          >
            {t.settings.useDeviceTimeZone}
          </Button>
          <span className="text-xs text-muted">{detectedTimeZone}</span>
        </div>
      )}
    </div>
  );
}
