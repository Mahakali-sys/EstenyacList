import { create } from "zustand";
import { api } from "./lib/api";
import type {
  AppSettings,
  CustomList,
  EntryView,
  GapRow,
  ImportReport,
  NekoFilters,
  NyaaFilters,
  PullReport,
  QueueItem,
  ScheduleStatus,
  ScheduleView,
  TabId,
} from "./lib/types";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export interface Toast {
  id: number;
  msg: string;
  kind: "info" | "success" | "error";
}

interface SheetState {
  entryId: number | null;
  anilistId: number | null;
  mediaType: "ANIME" | "MANGA";
  fromSchedule: boolean;
}

export type ImportPhase = { kind: "import" | "export"; processed: number; total: number; current: string } | null;

export interface PlayerTorrent {
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  percent: number;
}

export interface PlayerState {
  active: boolean;
  mode: "embedded" | "external" | null;
  resolving: boolean;
  title: string | null;
  episode: number | null;
  timePos: number;
  duration: number;
  paused: boolean;
  idle: boolean;
  volume: number;
  torrent: PlayerTorrent | null;
}

const PLAYER_INITIAL: PlayerState = {
  active: false,
  mode: null,
  resolving: false,
  title: null,
  episode: null,
  timePos: 0,
  duration: 0,
  paused: false,
  idle: true,
  volume: 60,
  torrent: null,
};

interface AppState {
  tab: TabId;
  setTab: (tab: TabId) => void;

  settings: AppSettings;
  loadSettings: () => Promise<void>;
  setSetting: (key: keyof AppSettings, value: unknown) => Promise<void>;

  customLists: CustomList[];
  loadCustomLists: () => Promise<void>;
  createCustomList: (mediaType: string, name: string) => Promise<number>;

  entries: Record<string, EntryView[]>;
  loadList: (mediaType: string, status?: string, customListId?: number) => Promise<void>;
  refreshEntries: (mediaType?: string) => Promise<void>;
  patchEntryLocal: (id: number, patch: Partial<EntryView>) => void;
  patchEntriesLocal: (updates: EntryView[]) => void;
  updateEntry: (patch: {
    id: number;
    status?: string;
    customListId?: number | null;
    score?: number;
    progress?: number;
    rewatches?: number;
    startDate?: string | null;
    finishDate?: string | null;
    notes?: string;
  }) => Promise<EntryView>;
  bulkUpdate: (
    ids: number[],
    patch: {
      status?: string;
      customListId?: number | null;
      score?: number;
      progress?: number;
      startDate?: string | null;
      finishDate?: string | null;
    },
  ) => Promise<number>;
  removeEntry: (id: number) => Promise<void>;
  removeEntryLocal: (id: number) => void;

  schedule: ScheduleView[] | null;
  scheduleStatus: ScheduleStatus | null;
  loadSchedule: () => Promise<void>;
  loadScheduleStatus: () => Promise<void>;

  gapReport: GapRow[];
  loadGapReport: () => Promise<void>;

  queue: QueueItem[];
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
  loadQueue: () => Promise<void>;
  queueAdd: (
    title: string,
    magnet: string,
    size?: string,
    entryId?: number | null,
    episode?: number | null,
  ) => Promise<void>;
  queueRemove: (id: number) => Promise<void>;
  queueClear: () => Promise<void>;
  queueReorder: (ids: number[]) => Promise<void>;

  hoverEntryId: number | null;
  setHoverEntry: (id: number | null) => void;
  flashEntry: { id: number; dir: 1 | -1; key: number } | null;
  flashProgress: (id: number, dir: 1 | -1) => void;

  images: Record<number, string>;
  requestImage: (anilistId: number) => Promise<string | null>;

  toasts: Toast[];
  toast: (msg: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;

  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  sheet: SheetState;
  openEntrySheet: (entryId: number) => void;
  openAnimeSheet: (anilistId: number, mediaType: "ANIME" | "MANGA", fromSchedule?: boolean) => void;
  closeSheet: () => void;

  importPhase: ImportPhase;
  setImportPhase: (p: ImportPhase) => void;
  importReport: ImportReport | null;
  setImportReport: (r: ImportReport | null) => void;

  pullFromAniList: () => Promise<PullReport>;

  player: PlayerState;
  patchPlayer: (patch: Partial<PlayerState>) => void;
  playerPlay: (
    source: string,
    title?: string | null,
    entryId?: number | null,
    episode?: number | null,
  ) => Promise<boolean>;
  playerStop: () => Promise<void>;
}

const SETTING_KEY_MAP: Record<string, string> = {
  mpvPath: "mpv_path",
  nyaaFilters: "nyaa_filters",
  nekoBase: "neko_base",
  nekoKey: "neko_key",
  nekoFilters: "neko_filters",
  nekoGroupNames: "neko_group_names",
  autoSearch: "auto_search",
  listView: "list_view",
  anilistClientId: "anilist_client_id",
  anilistSync: "anilist_sync",
  queueAutoAdvance: "queue_auto_advance",
  streamMode: "stream_mode",
  deleteAfterWatch: "delete_after_watch",
};

const ANILIST_FIELDS = [
  "status",
  "score",
  "progress",
  "startDate",
  "finishDate",
  "rewatches",
] as const;

const ANILIST_PENDING_KEY = "estenyac.anilist.pending";
const ANILIST_RETRY_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000];

const anilistTimers = new Map<number, ReturnType<typeof setTimeout>>();
const anilistPending = new Map<number, number>();
let anilistErrorAt = 0;

function readAniListPending() {
  try {
    const raw = localStorage.getItem(ANILIST_PENDING_KEY);
    if (!raw) return;
    const ids: unknown = JSON.parse(raw);
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id === "number") anilistPending.set(id, 0);
    }
  } catch {
    // ignore malformed state
  }
}

function persistAniListPending() {
  try {
    if (anilistPending.size === 0) {
      localStorage.removeItem(ANILIST_PENDING_KEY);
    } else {
      localStorage.setItem(
        ANILIST_PENDING_KEY,
        JSON.stringify([...anilistPending.keys()]),
      );
    }
  } catch {
    // ignore storage errors
  }
}

function scheduleAniListPush(id: number, delay: number) {
  if (!anilistPending.has(id)) {
    anilistPending.set(id, 0);
    persistAniListPending();
  }
  const prev = anilistTimers.get(id);
  if (prev) clearTimeout(prev);
  anilistTimers.set(
    id,
    setTimeout(() => {
      anilistTimers.delete(id);
      void flushAniListPush(id);
    }, delay),
  );
}

async function flushAniListPush(id: number) {
  if (!useStore.getState().settings.anilistSync) {
    anilistPending.delete(id);
    persistAniListPending();
    return;
  }
  try {
    await api.anilistPushEntry(id);
    anilistPending.delete(id);
    persistAniListPending();
  } catch (e) {
    const msg = String(e);
    if (
      msg.includes("entry not found") ||
      msg.includes("Not found on AniList") ||
      msg.includes(" 401")
    ) {
      anilistPending.delete(id);
      persistAniListPending();
      if (msg.includes(" 401")) {
        useStore
          .getState()
          .toast("AniList token rejected — reconnect in Settings", "error");
      }
      return;
    }
    const attempts = (anilistPending.get(id) ?? 0) + 1;
    anilistPending.set(id, attempts);
    persistAniListPending();
    const delay =
      ANILIST_RETRY_MS[Math.min(attempts - 1, ANILIST_RETRY_MS.length - 1)];
    scheduleAniListPush(id, delay);
    const now = Date.now();
    if (now - anilistErrorAt >= 60_000) {
      anilistErrorAt = now;
      useStore
        .getState()
        .toast(
          `AniList sync failed — retrying in ${Math.round(delay / 1000)}s`,
          "error",
        );
    }
  }
}

function touchesAniList(patch: object): boolean {
  return ANILIST_FIELDS.some(
    (k) => (patch as Record<string, unknown>)[k] !== undefined,
  );
}

function queueAniListSync(id: number) {
  if (!useStore.getState().settings.anilistSync) return;
  scheduleAniListPush(id, 900);
}

/// Sends every queued edit to AniList right now, skipping the debounce.
/// Used before a manual pull so the remote state is settled when it is read.
async function flushAllAniListPushes(): Promise<void> {
  const pending = [...anilistPending.keys()];
  const results = await Promise.allSettled(
    pending.map((id) => api.anilistPushEntry(id)),
  );
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      // keep the entry queued and retry instead of silently dropping the edit
      scheduleAniListPush(pending[i], ANILIST_RETRY_MS[0]);
      return;
    }
    const id = pending[i];
    anilistPending.delete(id);
    const timer = anilistTimers.get(id);
    if (timer) clearTimeout(timer);
    anilistTimers.delete(id);
  });
  persistAniListPending();
}

readAniListPending();

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (!useStore.getState().settings.anilistSync) return;
    for (const id of anilistPending.keys()) scheduleAniListPush(id, 1500);
  });
}

let imageChain: Promise<unknown> = Promise.resolve();
const imagePending = new Map<number, Promise<string | null>>();
let flashTimer: ReturnType<typeof setTimeout> | null = null;
// serializes queue reorder writes so a slower earlier request can't win
let queueReorderChain: Promise<void> = Promise.resolve();

export const useStore = create<AppState>((set, get) => ({
  tab: { kind: "list", mediaType: "ANIME", status: "CURRENT" },
  setTab: (tab) => set({ tab }),

  settings: {},
  loadSettings: async () => {
    const s = await api.getSettings();
    const parsed: AppSettings = {};
    parsed.accent = (s.accent as string) ?? "#e2543e";
    parsed.theme = (s.theme as AppSettings["theme"]) ?? "dark";
    parsed.mpvPath = (s.mpv_path as string) ?? "";
    parsed.nyaaFilters = (s.nyaa_filters as NyaaFilters) ?? undefined;
    parsed.nekoBase = (s.neko_base as string) ?? "https://nekobt.to";
    parsed.nekoKey = (s.neko_key as string) ?? "";
    parsed.nekoFilters = (s.neko_filters as NekoFilters) ?? undefined;
    parsed.nekoGroupNames = (s.neko_group_names as Record<string, string>) ?? undefined;
    parsed.tracker = (s.tracker as AppSettings["tracker"]) ?? undefined;
    parsed.autoSearch = s.auto_search !== false;
    parsed.notify = s.notify !== false;
    parsed.listView = s.list_view === "grid" ? "grid" : "list";
    parsed.anilistClientId = (s.anilist_client_id as string) ?? "";
    parsed.anilistUsername = (s.anilist_username as string) ?? "";
    parsed.anilistSync = s.anilist_sync === true;
    parsed.queueAutoAdvance = s.queue_auto_advance !== false;
    parsed.streamMode =
      s.stream_mode === "disk" ||
      (s.stream_mode == null && s.ram_streaming === false)
        ? "disk"
        : "ram";
    parsed.deleteAfterWatch = s.delete_after_watch === true;
    set({ settings: parsed });
    if (parsed.anilistSync) {
      for (const id of anilistPending.keys()) scheduleAniListPush(id, 3000);
    }
  },
  setSetting: async (key, value) => {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    if (key === "anilistSync" && value === false) {
      for (const timer of anilistTimers.values()) clearTimeout(timer);
      anilistTimers.clear();
      anilistPending.clear();
      persistAniListPending();
    } else if (key === "anilistSync" && value === true) {
      for (const id of anilistPending.keys()) scheduleAniListPush(id, 1000);
    }
    await api
      .setSettings(SETTING_KEY_MAP[key] ?? key, value)
      .catch((e) => get().toast(String(e), "error"));
  },

  customLists: [],
  loadCustomLists: async () => {
    const lists = await api.getCustomLists();
    set({ customLists: lists });
  },
  createCustomList: async (mediaType, name) =>
    api.createCustomList(mediaType, name),

  entries: {},
  loadList: async (mediaType, status, customListId) => {
    const key = `${mediaType}:${status ?? ""}:${customListId ?? ""}`;
    const entries = await api.getEntries(mediaType, status, customListId);
    set((s) => ({ entries: { ...s.entries, [key]: entries } }));
  },
  refreshEntries: async (mediaType) => {
    const s = get();
    const keys = Object.keys(s.entries).filter(
      (k) => !mediaType || k.startsWith(mediaType + ":"),
    );
    const next: Record<string, EntryView[]> = { ...s.entries };
    await Promise.all(
      keys.map(async (k) => {
        const [mt, status, cid] = k.split(":");
        next[k] = await api.getEntries(
          mt,
          status || undefined,
          cid ? Number(cid) : undefined,
        );
      }),
    );
    set({ entries: next });
  },
  patchEntryLocal: (id, patch) => {
    set((s) => {
      const prev = Object.values(s.entries)
        .flat()
        .find((e) => e.id === id);
      if (!prev) return s;
      const merged: EntryView = { ...prev, ...patch };
      const next: Record<string, EntryView[]> = {};
      for (const [k, list] of Object.entries(s.entries)) {
        const [mt, st, cid] = k.split(":");
        // re-add to every loaded bucket whose filter matches the patched entry
        const fits =
          mt === merged.mediaType &&
          (st === "" || merged.status === st) &&
          (cid === "" || String(merged.customListId ?? "") === cid);
        next[k] = list.filter((e) => e.id !== id);
        if (fits) next[k] = [merged, ...next[k]];
      }
      return { entries: next };
    });
  },
  patchEntriesLocal: (updates) => {
    if (updates.length === 0) return;
    set((s) => {
      const byId = new Map(updates.map((u) => [u.id, u]));
      const seen = new Set<number>();
      for (const list of Object.values(s.entries)) {
        for (const e of list) {
          if (byId.has(e.id)) seen.add(e.id);
        }
      }
      if (seen.size === 0) return s;
      const next: Record<string, EntryView[]> = {};
      for (const [k, list] of Object.entries(s.entries)) {
        const [mt, st, cid] = k.split(":");
        const updated: EntryView[] = [];
        const kept: EntryView[] = [];
        for (const e of list) {
          const u = byId.get(e.id);
          if (!u) {
            kept.push(e);
            continue;
          }
          const merged = { ...e, ...u };
          const fits =
            mt === merged.mediaType &&
            (st === "" || merged.status === st) &&
            (cid === "" || String(merged.customListId ?? "") === cid);
          // updated entries leave buckets that no longer match their filters
          if (fits) updated.push(merged);
        }
        next[k] = [...updated, ...kept];
      }
      return { entries: next };
    });
  },
  updateEntry: async (patch) => {
    let payload = patch;
    // first episode watched: stamp the start date if it is still empty
    if (
      patch.progress !== undefined &&
      patch.progress > 0 &&
      patch.startDate === undefined
    ) {
      let current = Object.values(get().entries)
        .flat()
        .find((e) => e.id === patch.id);
      if (!current) {
        try {
          current = await api.getEntry(patch.id);
        } catch {
          // entry may have been removed meanwhile
        }
      }
      if (current && current.progress === 0 && !current.startDate) {
        payload = { ...patch, startDate: todayISO() };
      }
    }
    const updated = await api.updateEntry(payload);
    get().patchEntryLocal(patch.id, updated);
    if (touchesAniList(patch)) queueAniListSync(patch.id);
    return updated;
  },
  bulkUpdate: async (ids, patch) => {
    if (ids.length === 0) return 0;
    const results = await Promise.allSettled(
      ids.map((id) => api.updateEntry({ id, ...patch })),
    );
    const updated = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    get().patchEntriesLocal(updated);
    if (touchesAniList(patch)) updated.forEach((e) => queueAniListSync(e.id));
    return updated.length;
  },
  removeEntry: async (id: number) => {
    await api.removeEntry(id);
  },
  removeEntryLocal: (id) => {
    set((s) => ({
      entries: Object.fromEntries(
        Object.entries(s.entries).map(([k, list]) => [
          k,
          list.filter((e) => e.id !== id),
        ]),
      ),
    }));
  },

  schedule: null,
  scheduleStatus: null,
  loadSchedule: async () => {
    const schedule = await api.scheduleNextWeek();
    set({ schedule });
  },
  loadScheduleStatus: async () => {
    const scheduleStatus = await api.scheduleStatus();
    set({ scheduleStatus });
  },

  gapReport: [],
  loadGapReport: async () => {
    try {
      set({ gapReport: await api.gapReport() });
    } catch {
      set({ gapReport: [] });
    }
  },

  queue: [],
  queueOpen: false,
  setQueueOpen: (open) => set({ queueOpen: open }),
  loadQueue: async () => {
    set({ queue: await api.queueList() });
  },
  queueAdd: async (title, magnet, size, entryId, episode) => {
    await api.queueAdd(title, magnet, size, entryId, episode);
    await get().loadQueue();
  },
  queueRemove: async (id) => {
    await api.queueRemove(id);
    await get().loadQueue();
  },
  queueClear: async () => {
    await api.queueClear();
    await get().loadQueue();
  },
  queueReorder: async (ids) => {
    const prev = get().queue;
    const byId = new Map(prev.map((q) => [q.id, q]));
    const next = ids.map((id) => byId.get(id)).filter((q): q is QueueItem => !!q);
    if (next.length !== prev.length) return;
    set({ queue: next });
    queueReorderChain = queueReorderChain.then(async () => {
      try {
        await api.queueReorder(ids);
      } catch (e) {
        get().toast(String(e), "error");
        await get().loadQueue();
      }
    });
    await queueReorderChain;
  },

  hoverEntryId: null,
  setHoverEntry: (id) => set({ hoverEntryId: id }),
  flashEntry: null,
  flashProgress: (id, dir) => {
    set({ flashEntry: { id, dir, key: Date.now() } });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(
      () => set({ flashEntry: null }),
      700,
    ) as unknown as number;
  },

  images: {},
  requestImage: async (anilistId) => {
    const cached = get().images[anilistId];
    if (cached) return cached;
    const pending = imagePending.get(anilistId);
    if (pending) return pending;
    const run = imageChain.then(async () => {
      const again = get().images[anilistId];
      if (again) return again;
      const data = await api.imageData(anilistId);
      if (data) {
        set((s) => ({ images: { ...s.images, [anilistId]: data } }));
        return data;
      }
      return null;
    });
    imageChain = run.then(
      () => undefined,
      () => undefined,
    );
    imagePending.set(anilistId, run);
    try {
      return await run;
    } catch {
      return null;
    } finally {
      imagePending.delete(anilistId);
    }
  },

  toasts: [],
  toast: (msg, kind = "info") => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, msg, kind }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  sheet: { entryId: null, anilistId: null, mediaType: "ANIME", fromSchedule: false },
  openEntrySheet: (entryId) =>
    set({ sheet: { entryId, anilistId: null, mediaType: "ANIME", fromSchedule: false } }),
  openAnimeSheet: (anilistId, mediaType, fromSchedule = false) =>
    set({ sheet: { entryId: null, anilistId, mediaType, fromSchedule } }),
  closeSheet: () => set({ sheet: { entryId: null, anilistId: null, mediaType: "ANIME", fromSchedule: false } }),

  importPhase: null,
  setImportPhase: (p) => set({ importPhase: p }),
  importReport: null,
  setImportReport: (r) => set({ importReport: r }),

  pullFromAniList: async () => {
    await flushAllAniListPushes();
    const report = await api.anilistPull();
    await Promise.all([get().refreshEntries(), get().loadCustomLists()]);
    return report;
  },

  player: PLAYER_INITIAL,
  patchPlayer: (patch) => {
    set((s) => ({ player: { ...s.player, ...patch } }));
  },
  playerPlay: async (source, title, entryId, episode) => {
    set((s) => ({
      player: {
        ...s.player,
        resolving: true,
        active: true,
        title: title ?? s.player.title,
        episode: episode ?? null,
        torrent: null,
      },
    }));
    try {
      await api.playerOpen(source, title ?? null, entryId ?? null, episode ?? null);
      set((s) => ({ player: { ...s.player, resolving: false } }));
      return true;
    } catch (e) {
      // the backend may already have started a torrent or the previous stream
      // may still be playing — close it so nothing keeps running invisibly
      await api.playerClose().catch(() => {});
      set({ player: { ...PLAYER_INITIAL, mode: get().player.mode } });
      get().toast(String(e), "error");
      return false;
    }
  },
  playerStop: async () => {
    try {
      await api.playerClose();
    } catch {
      // player may already be gone
    }
    set({ player: { ...PLAYER_INITIAL, mode: get().player.mode } });
  },
}));