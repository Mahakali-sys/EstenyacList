import { ListVideo, Loader2, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { Btn, Kbd } from "./ui";

export function TopBar() {
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const scheduleStatus = useStore((s) => s.scheduleStatus);
  const loadScheduleStatus = useStore((s) => s.loadScheduleStatus);
  const loadSchedule = useStore((s) => s.loadSchedule);
  const toast = useStore((s) => s.toast);
  const queueCount = useStore((s) => s.queue.length);
  const setQueueOpen = useStore((s) => s.setQueueOpen);
  const [syncing, setSyncing] = useState(false);

  const doResync = async () => {
    setSyncing(true);
    try {
      const n = await api.resyncSchedule();
      toast(`Schedule synced: ${n} entries`, "success");
      await Promise.all([loadSchedule(), loadScheduleStatus()]);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSyncing(false);
    }
  };

  const busy = syncing || scheduleStatus?.syncing;

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4">
      <div className="flex flex-1 items-center gap-2 font-mono text-[11px] text-fg-faint">
        {busy ? (
          <>
            <Loader2 size={11} className="animate-spin text-accent" />
            <span className="text-fg-muted">
              {scheduleStatus?.syncing ? "syncing weekly schedule…" : "working…"}
            </span>
          </>
        ) : scheduleStatus ? (
          <>
            <span
              className="inline-block h-1.5 w-1.5 bg-moss"
              title="Scheduler idle"
            />
            <span>
              {scheduleStatus.count} airing this week
              {scheduleStatus.lastSync
                ? ` · synced ${new Date(scheduleStatus.lastSync * 1000).toLocaleTimeString("pt-BR")}`
                : ""}
            </span>
          </>
        ) : (
          <span>loading…</span>
        )}
      </div>

      <Btn
        size="sm"
        onClick={doResync}
        disabled={busy}
        icon={
          busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} strokeWidth={1.75} />
          )
        }
        title="Re-sync weekly airing schedule from AniList"
      >
        Sync
      </Btn>

      <Btn
        size="sm"
        onClick={() => setQueueOpen(true)}
        className="relative"
        icon={<ListVideo size={12} strokeWidth={1.75} />}
        title="Watch queue (magnets to watch later)"
      >
        Queue
        {queueCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-[2px] bg-accent px-1 font-mono text-[9px] font-bold text-white">
            {queueCount > 99 ? "99+" : queueCount}
          </span>
        )}
      </Btn>

      <Btn
        size="sm"
        variant="primary"
        onClick={() => setSearchOpen(true)}
        icon={<Search size={12} strokeWidth={1.75} />}
      >
        Add to list
        <Kbd className="ml-1">Ctrl K</Kbd>
      </Btn>
    </header>
  );
}
