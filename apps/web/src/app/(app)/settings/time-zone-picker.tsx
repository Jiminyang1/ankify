"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Select } from "@/components/ui/field";
import { useHydrated } from "@/lib/use-hydrated";

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
  const [timeZones] = useState<string[]>(() => browserTimeZones(value));
  const detectedTimeZone = hydrated
    ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
    : "";

  return (
    <Select
      id={id}
      value={value}
      onValueChange={(nextValue) => {
        onChange(
          nextValue === "__device__" && detectedTimeZone
            ? detectedTimeZone
            : nextValue,
        );
      }}
    >
      {detectedTimeZone && (
        <option value="__device__">
          {t.settings.useDeviceTimeZone} — {detectedTimeZone}
        </option>
      )}
      {timeZones.map((timeZone) => (
        <option key={timeZone} value={timeZone}>
          {timeZone}
        </option>
      ))}
    </Select>
  );
}
