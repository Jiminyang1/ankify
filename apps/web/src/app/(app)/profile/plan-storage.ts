/** What the Plan page remembers between visits, per browser. Storage can be
 *  unavailable or hold junk, so readers check what they get and the page works
 *  without it. */

export const PLAN_STORAGE = {
  filters: "ankify.planList.filters",
  /** Shared by the map and the list: one list at a time on both. */
  only: "ankify.planList.only",
  site: "ankify.planList.site",
  open: "ankify.planList.open",
  nc150: "ankify.planList.nc150",
  mapLevel: "ankify.planMap.level",
  mapZoom: "ankify.planMap.zoom",
};

export function readStored(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the page still works for this visit.
  }
}

/** Keep the scope in the URL without a server round trip, so a meter link to
 *  the same list still counts as a change. */
export function replaceQuery(mutate: (params: URLSearchParams) => void) {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}
