"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during SSR/hydration, true once React is running in the browser. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
