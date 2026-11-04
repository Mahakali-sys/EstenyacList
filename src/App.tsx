import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { DetailSheet } from "./components/DetailSheet";
import { PlayerBar } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SearchOverlay } from "./components/SearchOverlay";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { api } from "./lib/api";
import { AiringPage } from "./pages/AiringPage";
import { ListView } from "./pages/ListView";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { useStore } from "./store";

/// Plays the next queued item (when auto-advance is on). Returns whether it
/// started.
async function advanceQueue(): Promise<boolean> {
  const st = useStore.getState();
  if (st.settings.queueAutoAdvance === false) return false;
  const next = st.queue[0];
  if (!next) return false;
  const ok = await st.playerPlay(
    next.magnet,
    next.title,
    next.entryId,
    next.episode,
  );
  if (ok) await st.queueRemove(next.id);
  return ok;
}

/// Shared by external-mpv (IPC pipe) and built-in player (libmpv EOF) paths:
/// bump progress, then auto-advance the queue or close the player.
async function handlePlaybackFinished(entryId: number, episode: number) {
  const st = useStore.getState();
  try {
    const entry = await api.getEntry(entryId);
    if (episode > entry.progress) {
      await st.updateEntry({ id: entry.id, progress: episode });
      st.flashProgress(entry.id, 1);
      st.toast(`finished · progress → ep ${episode}`, "success");
    }
  } catch {
    // entry may have been removed while playing
  }
  const advanced = await advanceQueue();
  if (!advanced) {
    await st.playerStop();
  }
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const settings = useStore((s) => s.settings);
  const loadSettings = useStore((s) => s.loadSettings);
  const loadCustomLists = useStore((s) => s.loadCustomLists);
  const loadSchedule = useStore((s) => s.loadSchedule);
  const loadScheduleStatus = useStore((s) => s.loadScheduleStatus);
  const loadQueue = useStore((s) => s.loadQueue);
  const toast = useStore((s) => s.toast);
  const setImportPhase = useStore((s) => s.setImportPhase);

  useEffect(() => {
    loadSettings();
    loadCustomLists();
    loadSchedule();
    loadScheduleStatus();
    loadQueue();

    const unlisteners: (() => void)[] = [];
    let disposed = false;
    const on = (ev: string, handler: (e: { payload: unknown }) => void) => {
      listen(ev, handler).then((un) => {
        if (disposed) {
          un();
        } else {
          unlisteners.push(un);
        }
      });
    };

    on("release-found", (e) => {
      const p = e.payload as {
        title?: string;
        episode?: number;
        size?: string;
      };
      toast(
        `New release! Ep ${p.episode ?? ""} ${p.title ?? ""}${p.size ? ` (${p.size})` : ""}`,
        "success",
      );
    });

    on("release-search-done", () => {
      loadSchedule();
    });

    on("schedule-synced", (e) => {
      const p = e.payload as { count?: number };
      loadSchedule();
      loadScheduleStatus();
      toast(`Airings synced (${p.count ?? "?"} this week)`, "info");
    });

    on("import-progress", (e) => {
      setImportPhase({
        kind: "import",
        ...(e.payload as { processed: number; total: number; current: string }),
      });
    });

    on("export-progress", (e) => {
      setImportPhase({
        kind: "export",
        current: "",
        ...(e.payload as { processed: number; total: number }),
      });
    });

    on("mpv-finished", (e) => {
      const p = e.payload as { entryId?: number; episode?: number };
      if (p.entryId == null || p.episode == null) return;
      void handlePlaybackFinished(p.entryId, p.episode);
    });

    on("player-opened", (e) => {
      const p = e.payload as {
        mode?: "embedded" | "external";
        title?: string;
        episode?: number | null;
      };
      useStore.getState().patchPlayer({
        active: true,
        mode: p.mode ?? "embedded",
        title: p.title ?? null,
        episode: p.episode ?? null,
        timePos: 0,
        duration: 0,
        paused: false,
      });
    });

    on("player-state", (e) => {
      const p = e.payload as {
        timePos?: number;
        duration?: number;
        paused?: boolean;
        idle?: boolean;
        title?: string | null;
        entryId?: number | null;
        episode?: number | null;
      };
      useStore.getState().patchPlayer({
        timePos: p.timePos ?? 0,
        duration: p.duration ?? 0,
        paused: p.paused ?? false,
        idle: p.idle ?? false,
        ...(p.title !== undefined ? { title: p.title } : {}),
      });
    });

    on("player-torrent", (e) => {
      const p = e.payload as {
        downloadedBytes?: number;
        totalBytes?: number;
        speedBytesPerSec?: number;
        percent?: number;
      };
      useStore.getState().patchPlayer({
        torrent: {
          downloadedBytes: p.downloadedBytes ?? 0,
          totalBytes: p.totalBytes ?? 0,
          speedBytesPerSec: p.speedBytesPerSec ?? 0,
          percent: p.percent ?? 0,
        },
      });
    });

    on("player-finished", (e) => {
      const p = e.payload as { entryId?: number | null; episode?: number | null };
      if (p.entryId == null || p.episode == null) {
        // unattributed playback — just advance the queue if there is one
        void advanceQueue();
        return;
      }
      void handlePlaybackFinished(p.entryId, p.episode);
    });

    on("player-error", (e) => {
      const p = e.payload as { message?: string };
      useStore.getState().toast(p.message ?? "playback failed", "error");
    });

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
  }, [
    loadSettings,
    loadCustomLists,
    loadSchedule,
    loadScheduleStatus,
    loadQueue,
    toast,
    setImportPhase,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const st = useStore.getState();
        st.setSearchOpen(!st.searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (settings.theme) {
      if (settings.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [settings.theme]);

  useEffect(() => {
    if (settings.accent) {
      document.documentElement.style.setProperty("--accent", settings.accent);
    }
  }, [settings.accent]);

  const page =
    tab.kind === "airing" ? (
      <AiringPage />
    ) : tab.kind === "list" ? (
      <ListView
        mediaType={tab.mediaType}
        status={tab.status}
        customListId={tab.customListId}
      />
    ) : tab.kind === "stats" ? (
      <StatsPage />
    ) : (
      <SettingsPage />
    );

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {page}
      </main>
      <SearchOverlay />
      <DetailSheet />
      <QueuePanel />
      <PlayerBar />
      <Toasts />
    </div>
  );
}
