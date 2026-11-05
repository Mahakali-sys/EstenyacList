import {
  Check,
  Languages,
  Loader2,
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";
import type { TrackInfo } from "../lib/types";
import { useStore } from "../store";
import { Dropdown } from "./Dropdown";
import { IconBtn } from "./ui";

// menu width (264px) plus the 8px gap it keeps from the window edge
const TRACK_MENU_INSET = 272;

function trackName(track: TrackInfo): string {
  const title = track.title?.trim();
  if (title) return title;
  const lang = track.lang?.trim();
  if (lang) return lang.toUpperCase();
  return `Track ${track.id}`;
}

function trackDetail(track: TrackInfo): string | null {
  const parts: string[] = [];
  if (track.lang && track.title) parts.push(track.lang);
  if (track.codec) parts.push(track.codec);
  if (track.default) parts.push("default");
  if (track.external) parts.push("external");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function TrackRow({
  label,
  detail,
  selected,
  onClick,
}: {
  label: string;
  detail?: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`menu-item ${selected ? "!text-accent" : ""}`} onClick={onClick}>
      <span className="flex w-3.5 shrink-0 justify-center">
        {selected && <Check size={12} strokeWidth={2.25} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && (
          <span className="block truncate font-mono text-[9px] text-fg-faint">
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}

function fmtSpeed(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB/s`;
}

export function PlayerBar() {
  const player = useStore((s) => s.player);
  const patchPlayer = useStore((s) => s.patchPlayer);
  const playerStop = useStore((s) => s.playerStop);
  const queue = useStore((s) => s.queue);
  const [fullscreen, setFullscreen] = useState(false);
  // while dragging the seek slider, don't let position events fight the thumb
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const wasActive = useRef(false);

  // Commit on the window instead of the input: when the pointer is released
  // outside the slider the input never sees pointerup, and seekValue would stay
  // latched, freezing the elapsed time even though playback continues.
  useEffect(() => {
    const end = (e: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      const el = seekRef.current;
      setSeekValue(null);
      if (e.type === "pointercancel" || !el) return;
      void api.playerSeek(Number(el.value)).catch(() => {});
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const embedded = player.mode === "embedded";
  const playing = !player.paused && !player.idle;

  useEffect(() => {
    if (!player.active) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // sliders are not text entry: arrow keys must seek/change volume instead
      // of silently moving the thumb, so they fall through to the handler.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true ||
        (tag === "INPUT" && (target as HTMLInputElement).type !== "range");
      if (typing) return;
      const st = useStore.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (e.repeat) break;
          if (embedded) void api.playerTogglePause().catch(() => {});
          break;
        case "ArrowRight":
          if (embedded) {
            e.preventDefault();
            void api.playerSeekRel(5).catch(() => {});
          }
          break;
        case "ArrowLeft":
          if (embedded) {
            e.preventDefault();
            void api.playerSeekRel(-5).catch(() => {});
          }
          break;
        case "ArrowUp":
          if (embedded) {
            e.preventDefault();
            const v = Math.min(130, st.player.volume + 5);
            st.patchPlayer({ volume: v });
            void api.playerSetVolume(v).catch(() => {});
          }
          break;
        case "ArrowDown":
          if (embedded) {
            e.preventDefault();
            const v = Math.max(0, st.player.volume - 5);
            st.patchPlayer({ volume: v });
            void api.playerSetVolume(v).catch(() => {});
          }
          break;
        case "Escape":
          e.preventDefault();
          void playerStop();
          break;
        case "n":
        case "N": {
          const next = st.queue[0];
          if (next) {
            const ok = await st.playerPlay(next.magnet, next.title, next.entryId, next.episode);
            if (ok) void st.queueRemove(next.id);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player.active, embedded, playerStop]);

  // keep the fullscreen button in sync with OS/window-driven toggles
  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win
        .isFullscreen()
        .then((f) => {
          if (!disposed) setFullscreen(f);
        })
        .catch(() => {});
    };
    sync();
    void win
      .onResized(sync)
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // the video surface must take its space back if playback stops while the
  // track menu is open (the menu unmounts without closing in that case)
  useEffect(() => {
    if (!player.active) void api.playerSetSideInset(0).catch(() => {});
  }, [player.active]);

  // closing the player while fullscreen would leave the window with no
  // visible controls at all, so restore it when playback ends
  useEffect(() => {
    if (player.active) {
      wasActive.current = true;
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    setFullscreen(false);
    const win = getCurrentWindow();
    void win
      .isFullscreen()
      .then((f) => (f ? win.setFullscreen(false) : undefined))
      .catch(() => {});
  }, [player.active]);

  if (!player.active) return null;

  const dur = player.duration > 0 ? player.duration : 0;
  const shown = seekValue ?? player.timePos;

  const playNext = async () => {
    const next = queue[0];
    if (!next) return;
    const st = useStore.getState();
    const ok = await st.playerPlay(next.magnet, next.title, next.entryId, next.episode);
    if (ok) void st.queueRemove(next.id);
  };

  const toggleFullscreen = async () => {
    const win = getCurrentWindow();
    const next = !fullscreen;
    try {
      await win.setFullscreen(next);
      setFullscreen(next);
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  };

  const audioTracks = player.tracks.filter((t) => t.type === "audio");
  const subTracks = player.tracks.filter((t) => t.type === "sub");
  const subtitlesOff = !subTracks.some((t) => t.selected);

  const refreshTracks = async () => {
    try {
      patchPlayer({ tracks: await api.playerTracks() });
    } catch {
      // the player may have closed while the menu was opening
    }
  };

  const chooseAudio = async (id: number | null) => {
    try {
      patchPlayer({ tracks: await api.playerSetAudioTrack(id) });
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  };

  const chooseSubtitle = async (id: number | null, auto = false) => {
    try {
      patchPlayer({ tracks: await api.playerSetSubtitleTrack(id, auto) });
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-t border-edge bg-surface px-3">
      {/* title */}
      <div className="flex min-w-0 shrink-0 items-center gap-2" style={{ width: 220 }}>
        {player.resolving ? (
          <>
            <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
            <span className="truncate font-mono text-[10px] text-fg-muted">
              connecting to swarm…
            </span>
          </>
        ) : (
          <div className="min-w-0">
            <div className="truncate text-[11.5px] font-semibold leading-tight" title={player.title ?? undefined}>
              {player.title ?? "Playing"}
            </div>
            <div className="font-mono text-[9px] text-fg-faint">
              {player.episode != null ? `ep ${player.episode} · ` : ""}
              {player.mode === "external" ? "external mpv" : "built-in player"}
            </div>
          </div>
        )}
      </div>

      {/* transport */}
      {embedded && !player.resolving ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn title="Back 5s (←)" onClick={() => void api.playerSeekRel(-5).catch(() => {})}>
            <SkipBack size={14} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn
            title={playing ? "Pause (space)" : "Play (space)"}
            className="!h-9 !w-9 border border-edge bg-surface-2"
            onClick={() => void api.playerTogglePause().catch(() => {})}
          >
            {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </IconBtn>
          <IconBtn
            title="Play next in queue (n)"
            disabled={queue.length === 0}
            onClick={playNext}
          >
            <SkipForward size={14} strokeWidth={1.75} />
          </IconBtn>
        </div>
      ) : null}

      {/* seek */}
      {embedded && !player.resolving ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-mono text-[10px] text-fg-muted tnum">
            {fmtTime(shown)}
          </span>
          <input
            ref={seekRef}
            type="range"
            className="min-w-0 flex-1 accent-[var(--accent)]"
            min={0}
            max={dur || 1}
            step={1}
            value={shown}
            onPointerDown={() => (dragging.current = true)}
            onChange={(e) => {
              // keyboard/other value changes without an active drag must not
              // leave a stale local value pinning the bar
              if (dragging.current) setSeekValue(Number(e.target.value));
            }}
          />
          <span className="shrink-0 font-mono text-[10px] text-fg-faint tnum">
            {fmtTime(dur)}
          </span>
        </div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}

      {/* torrent progress — whole-file download percent */}
      {player.torrent && player.torrent.percent < 100 && (
        <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
          <div className="h-1 w-16 overflow-hidden bg-surface-2">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, player.torrent.percent)}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-fg-faint tnum">
            {Math.round(player.torrent.percent)}% · {fmtSpeed(player.torrent.speedBytesPerSec)}
          </span>
        </div>
      )}

      {/* volume */}
      {embedded && !player.resolving ? (
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          <IconBtn
            title={player.volume === 0 ? "Unmute" : "Mute"}
            onClick={() => {
              const v = player.volume === 0 ? 100 : 0;
              patchPlayer({ volume: v });
              void api.playerSetVolume(v).catch(() => {});
            }}
          >
            {player.volume === 0 ? (
              <VolumeX size={14} strokeWidth={1.75} />
            ) : (
              <Volume2 size={14} strokeWidth={1.75} />
            )}
          </IconBtn>
          <input
            type="range"
            className="w-16 accent-[var(--accent)]"
            min={0}
            max={130}
            step={1}
            value={player.volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              patchPlayer({ volume: v });
              void api.playerSetVolume(v).catch(() => {});
            }}
          />
        </div>
      ) : null}

      {embedded && !player.resolving ? (
        <Dropdown
          align="right"
          className="w-[264px]"
          onOpenChange={(open) => {
            void api
              .playerSetSideInset(open ? TRACK_MENU_INSET : 0)
              .catch(() => {});
          }}
          trigger={
            <IconBtn
              title="Audio and subtitle tracks"
              onClick={() => void refreshTracks()}
            >
              <Languages size={14} strokeWidth={1.75} />
            </IconBtn>
          }
        >
          {() => (
            <>
              <div className="label-caps px-2.5 pb-1 pt-1">audio</div>
              {audioTracks.map((t) => (
                <TrackRow
                  key={`audio-${t.id}`}
                  label={trackName(t)}
                  detail={trackDetail(t)}
                  selected={t.selected}
                  onClick={() => void chooseAudio(t.id)}
                />
              ))}
              {audioTracks.length === 0 && (
                <div className="px-2.5 py-1.5 font-mono text-[9.5px] text-fg-faint">
                  no audio tracks reported yet
                </div>
              )}

              <div className="my-1 border-t border-edge" />
              <div className="label-caps px-2.5 pb-1 pt-1">subtitles</div>
              <TrackRow
                label="Off"
                selected={subtitlesOff}
                onClick={() => void chooseSubtitle(null)}
              />
              {subTracks.map((t) => (
                <TrackRow
                  key={`sub-${t.id}`}
                  label={trackName(t)}
                  detail={trackDetail(t)}
                  selected={t.selected}
                  onClick={() => void chooseSubtitle(t.id)}
                />
              ))}
              {subTracks.length === 0 && (
                <div className="px-2.5 py-1.5 font-mono text-[9.5px] text-fg-faint">
                  no subtitle tracks reported yet
                </div>
              )}
            </>
          )}
        </Dropdown>
      ) : null}

      <IconBtn
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        onClick={() => void toggleFullscreen()}
      >
        <Maximize size={14} strokeWidth={1.75} />
      </IconBtn>
      <IconBtn title="Close player (esc)" onClick={() => void playerStop()}>
        <X size={15} strokeWidth={1.75} />
      </IconBtn>
    </div>
  );
}
