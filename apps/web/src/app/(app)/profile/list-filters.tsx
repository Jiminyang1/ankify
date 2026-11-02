"use client";

import type { PlanCatalogTag } from "@ankify/core/plan-catalog";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Surface } from "@/components/ui/surface";
import { PLAN_CAPS, PLAN_ONLY, PLAN_TAGS, filtersActive, type PlanFilters, type PlanOnly, type PlanSite } from "./plan-map-model";
import { PlanSegments } from "./plan-map-parts";

/** The list view's filter panel, count line, and clear-filters banner. */
export function ListFilterPanel({
  filters,
  onFilters,
  only,
  onOnly,
  site,
  onSite,
  countLine,
  cutLine,
}: {
  filters: PlanFilters;
  onFilters: (next: PlanFilters) => void;
  only: PlanOnly;
  onOnly: (next: PlanOnly) => void;
  site: PlanSite;
  onSite: (next: PlanSite) => void;
  countLine: string;
  cutLine: string | null;
}) {
  const { t } = useLanguage();
  const copy = t.planMap;
  const labels = copy.filters;
  const check = (key: "hidePremium" | "hideDone" | "onlyDue", label: string) => (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={filters[key]}
        onChange={(event) => onFilters({ ...filters, [key]: event.target.checked })}
        className="size-4 cursor-pointer accent-[rgb(var(--accent))]"
      />
      {label}
    </label>
  );

  const parts = [
    only !== "all" && copy.banner.scoped(copy.only[only]),
    filters.tag && copy.banner.tag(copy.tags[filters.tag]),
    filters.q.trim() && copy.banner.search(filters.q.trim()),
    filters.cap > 0 && copy.banner.cap(filters.cap),
    filters.hidePremium && copy.banner.hidePremium,
    filters.hideDone && copy.banner.hideDone,
    filters.onlyDue && copy.banner.onlyDue,
  ].filter((part): part is string => Boolean(part));

  return (
    <>
      <Surface className="space-y-3 p-4">
        <Input
          type="search"
          aria-label={labels.search}
          placeholder={labels.searchPlaceholder}
          value={filters.q}
          onChange={(event) => onFilters({ ...filters, q: event.target.value })}
        />
        <PlanSegments
          label={copy.only.label}
          value={only}
          options={PLAN_ONLY.map((option) => ({ id: option, label: copy.only[option] }))}
          onChange={onOnly}
        />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <Field label={labels.tag} className="w-32">
            <Select
              aria-label={labels.tag}
              value={filters.tag}
              onValueChange={(value) => onFilters({ ...filters, tag: value as PlanCatalogTag | "" })}
            >
              <option value="">{labels.anyTag}</option>
              {PLAN_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {copy.tags[tag]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={labels.cap} className="w-32">
            <Select
              aria-label={labels.cap}
              value={String(filters.cap)}
              onValueChange={(value) => onFilters({ ...filters, cap: Number(value) })}
            >
              <option value="0">{labels.anyCap}</option>
              {PLAN_CAPS.map((cap) => (
                <option key={cap} value={String(cap)}>
                  {labels.capAtMost(cap)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1">
            {check("hidePremium", labels.hidePremium)}
            {check("hideDone", labels.hideDone)}
            {check("onlyDue", labels.onlyDue)}
          </div>
          <Field label={labels.site} className="w-40 sm:ml-auto">
            <Select aria-label={labels.site} value={site} onValueChange={(value) => onSite(value as PlanSite)}>
              <option value="com">leetcode.com</option>
              <option value="cn">leetcode.cn</option>
            </Select>
          </Field>
        </div>
        <p aria-live="polite" className="text-xs leading-5 text-muted">
          {countLine}
          {cutLine && <span className="block">{cutLine}</span>}
        </p>
      </Surface>

      {filtersActive(filters) && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-accent-soft px-4 py-2.5 text-sm"
        >
          <span className="min-w-0">
            {copy.banner.filtering(parts.join(copy.banner.separator))} <span className="text-muted">{copy.banner.grey}</span>
          </span>
          <Button size="xs" onClick={() => onFilters({ ...filters, q: "", tag: "", cap: 0, hidePremium: false, hideDone: false, onlyDue: false })}>
            {labels.clear}
          </Button>
        </div>
      )}
    </>
  );
}
