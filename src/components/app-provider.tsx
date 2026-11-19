"use client";

import * as React from "react";
import { computeBalances, simplifyDebts, totalSpend } from "@/lib/core/balances";
import type { BalanceMap, Transfer } from "@/lib/core/balances";
import { IS_DEMO } from "@/lib/supabase/env";
import { DemoRepo, LocalDemoStorage } from "@/lib/store/demo";
import { SupabaseRepo } from "@/lib/store/supabase";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AccessDeniedError } from "@/lib/store/types";
import type { Repo } from "@/lib/store/types";
import type { Group, GroupBundle, Member, Profile } from "@/lib/types";

const GROUP_KEY = "cs:group";

interface AppState {
  repo: Repo | null;
  isDemo: boolean;
  /** False until the first session + group load has finished. */
  ready: boolean;
  me: Profile | null;
  groups: Group[];
  groupId: string | null;
  data: GroupBundle | null;
  refreshing: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  reloadAll: () => Promise<void>;
  selectGroup: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
  // derived
  members: Member[];
  memberById: (id: string) => Member | undefined;
  balances: BalanceMap;
  transfers: Transfer[];
  totalFils: number;
}

const AppContext = React.createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [repo, setRepo] = React.useState<Repo | null>(null);
  const [ready, setReady] = React.useState(false);
  const [me, setMe] = React.useState<Profile | null>(null);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [groupId, setGroupId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<GroupBundle | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadBundle = React.useCallback(async (r: Repo, id: string) => {
    setRefreshing(true);
    try {
      setData(await r.loadGroup(id));
      setLoadError(null);
    } catch (e) {
      if (e instanceof AccessDeniedError) setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load group");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const load = React.useCallback(
    async (r: Repo) => {
      try {
        const user = await r.getCurrentUser();
        setMe(user);
        if (!user) {
          setGroups([]);
          setGroupId(null);
          setData(null);
          return;
        }
        const gs = await r.listGroups();
        setGroups(gs);
        let stored: string | null = null;
        try {
          stored = window.localStorage.getItem(GROUP_KEY);
        } catch {
          /* ignore */
        }
        const chosen = gs.find((g) => g.id === stored)?.id ?? gs[0]?.id ?? null;
        setGroupId(chosen);
        if (chosen) await loadBundle(r, chosen);
        else setData(null);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load your data");
      }
    },
    [loadBundle],
  );

  React.useEffect(() => {
    const r: Repo = IS_DEMO
      ? new DemoRepo(new LocalDemoStorage())
      : new SupabaseRepo(getSupabaseBrowserClient());
    setRepo(r);
    load(r).finally(() => setReady(true));
  }, [load]);

  const refresh = React.useCallback(async () => {
    if (repo && groupId) await loadBundle(repo, groupId);
  }, [repo, groupId, loadBundle]);

  const reloadAll = React.useCallback(async () => {
    if (repo) await load(repo);
  }, [repo, load]);

  const selectGroup = React.useCallback(
    async (id: string) => {
      setGroupId(id);
      setData(null); // show skeleton instead of the previous group's data
      try {
        window.localStorage.setItem(GROUP_KEY, id);
      } catch {
        /* ignore */
      }
      if (repo) await loadBundle(repo, id);
    },
    [repo, loadBundle],
  );

  const signOut = React.useCallback(async () => {
    if (!repo) return;
    await repo.signOut();
    setMe(null);
    setGroups([]);
    setGroupId(null);
    setData(null);
  }, [repo]);

  const members = React.useMemo(() => data?.members ?? [], [data]);
  const balances = React.useMemo(
    () => computeBalances(members.map((m) => m.userId), data?.expenses ?? [], data?.settlements ?? []),
    [members, data],
  );
  const transfers = React.useMemo(() => simplifyDebts(balances), [balances]);
  const totalFils = React.useMemo(() => totalSpend(data?.expenses ?? []), [data]);

  const value: AppState = {
    repo,
    isDemo: IS_DEMO,
    ready,
    me,
    groups,
    groupId,
    data,
    refreshing,
    loadError,
    refresh,
    reloadAll,
    selectGroup,
    signOut,
    members,
    memberById: (id) => members.find((m) => m.userId === id),
    balances,
    transfers,
    totalFils,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Name for display; falls back gracefully for former members. */
export function useName() {
  const { memberById, me } = useApp();
  return (id: string) => (id === me?.id ? "You" : (memberById(id)?.profile.name ?? "Former member"));
}
