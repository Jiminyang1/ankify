import type { AuthUserDto } from "@ankify/contracts";
import type { ApiClient } from "./api";

export type AccountState =
  | { kind: "signed_in"; user: AuthUserDto }
  | { kind: "signed_out" }
  /** The backend could not be reached; `cached` is the last confirmed account. */
  | { kind: "unknown"; cached: AuthUserDto | null };

export type KeyValueStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

const CACHE_KEY = "ankify.account";
const FRESH_MS = 60_000;

/**
 * The Ankify account the extension acts for. The last confirmed account is
 * persisted so work done offline is still scoped to it; it is never assumed
 * to be the account a later sign-in belongs to.
 */
export function createAccountState(deps: { api: ApiClient; store: KeyValueStore; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let memo: { state: AccountState; at: number } | null = null;

  async function cached(): Promise<AuthUserDto | null> {
    const value = (await deps.store.get(CACHE_KEY)) as { user?: AuthUserDto; origin?: string } | undefined;
    return value?.origin === deps.api.origin && value.user?.id ? value.user : null;
  }

  async function refresh(): Promise<AccountState> {
    const result = await deps.api.request<{ user?: AuthUserDto }>("/api/me");
    let state: AccountState;
    if (result.ok && result.data?.user?.id) {
      state = { kind: "signed_in", user: result.data.user };
      await deps.store.set(CACHE_KEY, { user: result.data.user, origin: deps.api.origin });
    } else if (!result.ok && result.kind === "auth") {
      state = { kind: "signed_out" };
    } else {
      state = { kind: "unknown", cached: await cached() };
    }
    memo = { state, at: now() };
    return state;
  }

  return {
    async current(options: { fresh?: boolean } = {}): Promise<AccountState> {
      if (!options.fresh && memo && now() - memo.at < FRESH_MS && memo.state.kind !== "unknown") return memo.state;
      return refresh();
    },
    /** The account new durable work belongs to, or null when none is known. */
    async scopeAccountId(): Promise<string | null> {
      const state = await this.current();
      if (state.kind === "signed_in") return state.user.id;
      if (state.kind === "unknown") return state.cached?.id ?? null;
      return null;
    },
    /** Forget the memo after a 401 or a sign-in, so the next read asks the server. */
    invalidate() {
      memo = null;
    },
  };
}

export type AccountStateApi = ReturnType<typeof createAccountState>;
