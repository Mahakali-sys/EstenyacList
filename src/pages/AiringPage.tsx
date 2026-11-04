import {
  BookOpen,
  CheckCircle2,
  Clock,
  ListPlus,
  Loader2,
  Magnet,
  Plus,
  Radar,
  Radio,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { EntryView, ScheduleView } from "../lib/types";
import { WEEKDAYS, fmtCountdown, spHourMinute, spWeekday, statusLabel } from "../lib/types";
import { useStore } from "../store";
import { Cover } from "../components/Cover";
import { IconBtn, Seg, Toggle } from "../components/ui";

const STALE_DAYS = 14;

// survives navigating away and back within the session
let lastAiringTab: "ANIME" | "MANGA" = "ANIME";

function hourOf(atSeconds: number): string {
  return spHourMinute(atSeconds).slice(0, 5);
}

function fmtCh(c: number): string {
  return Number.isInteger(c) ? String(c) : c.toFixed(1);
}

const MANGA_STATUS_ORDER = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED"];

export function AiringPage() {
  const schedule = useStore((s) => s.schedule);
  const loadSchedule = useStore((s) => s.loadSchedule);
  const loadScheduleStatus = useStore((s) => s.loadScheduleStatus);
  const loadGapReport = useStore((s) => s.loadGapReport);
  const gapReport = useStore((s) => s.gapReport);
  const toast = useStore((s) => s.toast);
  const openAnimeSheet = useStore((s) => s.openAnimeSheet);
  const openEntrySheet = useStore((s) => s.openEntrySheet);
  const autoSearch = useStore((s) => s.settings.autoSearch);
  const setSetting = useStore((s) => s.setSetting);
  const sheet = useStore((s) => s.sheet);
  const [airingTab, setAiringTabState] = useState<"ANIME" | "MANGA">(lastAiringTab);
  const setAiringTab = (t: "ANIME" | "MANGA") => {
    lastAiringTab = t;
    setAiringTabState(t);
  };
  const [searchingId, setSearchingId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [mangaEntries, setMangaEntries] = useState<EntryView[] | null>(null);

  useEffect(() => {
    loadSchedule();
    loadScheduleStatus();
    loadGapReport();
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [loadSchedule, loadScheduleStatus, loadGapReport]);

  // manga tab reads straight from the local list (AniList data), refreshed
  // whenever the detail sheet closes so edits show up immediately
  useEffect(() => {
    if (airingTab !== "MANGA") return;
    api
      .getEntries("MANGA")
      .then(setMangaEntries)
      .catch(() => setMangaEntries([]));
  }, [airingTab, sheet.entryId, sheet.anilistId]);

  const grouped = useMemo(() => {
    if (!schedule) return null;
    const today = spWeekday(now / 1000);
    const order = Array.from({ length: 7 }, (_, i) => (today + i) % 7);
    return order.map((day) => {
      const items = schedule
        .filter((s) => spWeekday(s.airingAt) === day)
        .sort((a, b) => a.airingAt - b.airingAt);
      const hours: { hour: string; items: ScheduleView[] }[] = [];
      for (const item of items) {
        const h = hourOf(item.airingAt);
        const last = hours[hours.length - 1];
        if (last && last.hour === h) last.items.push(item);
        else hours.push({ hour: h, items: [item] });
      }
      return { day, label: WEEKDAYS[day], hours, count: items.length };
    });
  }, [schedule, now]);

  const openMpv = (
    magnet: string,
    entryId: number | null,
    episode: number | null,
    title: string | null,
  ) => {
    void useStore.getState().playerPlay(magnet, title, entryId, episode);
  };

  const queueMagnet = async (
    label: string,
    magnet: string,
    size?: string | null,
    entryId?: number | null,
    episode?: number | null,
  ) => {
    try {
      await useStore
        .getState()
        .queueAdd(label, magnet, size ?? undefined, entryId ?? null, episode ?? null);
      toast("Added to watch queue", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  // CURRENT shows that stopped receiving releases (hiatus / strict filters)
  const staleShows = useMemo(() => {
    const cutoff = STALE_DAYS * 86400;
    return gapReport
      .filter((g) => g.latestReleaseAt != null && now / 1000 - g.latestReleaseAt > cutoff)
      .map((g) => ({
        ...g,
        days: Math.floor((now / 1000 - (g.latestReleaseAt ?? 0)) / 86400),
      }))
      .sort((a, b) => b.days - a.days);
  }, [gapReport, now]);

  const searchNow = async (item: ScheduleView) => {
    setSearchingId(item.anilistId);
    try {
      const found = await api.searchReleasesNow(item.anilistId, item.episode);
      await loadSchedule();
      loadGapReport();
      toast(
        found
          ? `Found ${found} release(s) for ${item.titleRomaji} ep ${item.episode}`
          : `No releases for ${item.titleRomaji} ep ${item.episode}`,
        found ? "success" : "info",
      );
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearchingId(null);
    }
  };

  const retryFresh = async (anilistId: number, progress: number, title: string | null) => {
    setSearchingId(anilistId);
    try {
      const found = await api.searchReleasesNow(anilistId, progress + 1);
      await loadGapReport();
      toast(
        found
          ? `Found ${found} release(s) for ${title ?? "entry"}`
          : `No releases for ${title ?? "entry"} ep ${progress + 1}`,
        found ? "success" : "info",
      );
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearchingId(null);
    }
  };

  const sortedManga = useMemo(() => {
    if (!mangaEntries) return null;
    return [...mangaEntries].sort(
      (a, b) =>
        MANGA_STATUS_ORDER.indexOf(a.status) - MANGA_STATUS_ORDER.indexOf(b.status) ||
        (a.title ?? "").localeCompare(b.title ?? ""),
    );
  }, [mangaEntries]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div className="flex items-baseline gap-2">
          {airingTab === "ANIME" ? (
            <Radio size={14} className="self-center text-accent" strokeWidth={1.75} />
          ) : (
            <BookOpen size={14} className="self-center text-accent" strokeWidth={1.75} />
          )}
          <h1 className="display text-[17px] font-semibold">
            {airingTab === "ANIME" ? "Airing this week" : "Manga tracking"}
          </h1>
          {airingTab === "ANIME" && (
            <span className="hidden font-mono text-[10px] text-fg-faint lg:inline">
              times in JST (as announced) · auto-search ~15 min after airing
            </span>
          )}
          {airingTab === "MANGA" && (
            <span className="hidden font-mono text-[10px] text-fg-faint lg:inline">
              your reading list, from AniList data
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Seg<"ANIME" | "MANGA">
            value={airingTab}
            onChange={setAiringTab}
            options={[
              { id: "ANIME", label: "Anime" },
              { id: "MANGA", label: "Manga" },
            ]}
          />
          {airingTab === "ANIME" && (
            <Toggle
              checked={autoSearch !== false}
              onChange={(v) => setSetting("autoSearch", v)}
              label="Auto-search releases"
            />
          )}
        </div>
      </div>

      {airingTab === "MANGA" ? (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {!sortedManga ? (
            <div className="flex items-center justify-center gap-2 py-24">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="font-mono text-[11px] text-fg-muted">
                loading your manga list…
              </span>
            </div>
          ) : sortedManga.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
              <BookOpen size={26} strokeWidth={1.5} className="text-fg-faint" />
              <div className="text-[13px] font-semibold">No manga on your list</div>
              <div className="font-mono text-[10.5px] text-fg-faint">
                add manga from search (Ctrl+K) and they show up here
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pb-3 font-mono text-[10px] text-fg-faint tnum">
                {MANGA_STATUS_ORDER.map((s) => {
                  const n = sortedManga.filter((e) => e.status === s).length;
                  if (n === 0) return null;
                  return (
                    <span key={s}>
                      {statusLabel(s, true)} <b className="text-fg-muted">{n}</b>
                    </span>
                  );
                })}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {sortedManga.map((e) => {
                  const pct =
                    e.total && e.total > 0
                      ? Math.min(100, Math.round((e.progress / e.total) * 100))
                      : null;
                  return (
                    <div
                      key={e.id}
                      className="group cursor-pointer border border-edge bg-surface-2/30 p-2 transition-colors hover:border-edge-2"
                      onClick={() => openEntrySheet(e.id)}
                    >
                      <div className="flex gap-2.5">
                        <Cover
                          anilistId={e.anilistId}
                          coverUrl={e.coverUrl}
                          title={e.title}
                          className="h-[76px] w-[52px] shrink-0 overflow-hidden rounded-[2px] border border-edge/70"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-[12px] font-semibold leading-tight">
                            {e.title ?? `#${e.anilistId}`}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span
                              className={`px-1 font-mono text-[9px] font-semibold ${
                                e.status === "CURRENT"
                                  ? "bg-accent/15 text-accent"
                                  : "bg-surface-2 text-fg-faint"
                              }`}
                            >
                              {statusLabel(e.status, true)}
                            </span>
                            {e.mediaStatus === "RELEASING" && (
                              <span className="bg-moss/15 px-1 font-mono text-[9px] font-semibold text-moss">
                                ongoing
                              </span>
                            )}
                            {e.format && (
                              <span className="bg-surface-2 px-1 font-mono text-[9px] text-fg-faint">
                                {e.format}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="shrink-0 font-mono text-[9.5px] text-fg-muted tnum">
                              ch {fmtCh(e.progress)}
                              {e.total != null && e.total > 0 ? ` / ${e.total}` : ""}
                            </span>
                            {pct != null && (
                              <div className="h-1 min-w-0 flex-1 overflow-hidden bg-surface-2">
                                <div
                                  className="h-full bg-accent transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-auto px-4 pb-4">
          {!grouped ? (
            <div className="flex items-center justify-center gap-2 py-24">
              <Loader2 size={20} className="animate-spin text-accent" />
              <span className="font-mono text-[11px] text-fg-muted">
                loading weekly schedule…
              </span>
            </div>
          ) : (
            <>
              {staleShows.length > 0 && (
                <div className="anim-in mb-3 flex items-start gap-2.5 border border-ochre/40 bg-ochre/8 px-3 py-2.5">
                  <TriangleAlert size={15} className="mt-0.5 shrink-0 text-ochre" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-ochre">
                      Gap radar
                      <span className="font-mono text-[10px] font-normal text-fg-muted">
                        · {staleShows.length} show{staleShows.length === 1 ? "" : "s"}{" "}
                        without a new release for {STALE_DAYS}+ days (hiatus or
                        filters too strict?)
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {staleShows.map((g) => (
                        <span
                          key={g.anilistId}
                          className="flex items-center gap-1.5 border border-ochre/30 bg-surface px-2 py-0.5 text-[10.5px] font-semibold"
                        >
                          <button
                            className="max-w-52 truncate text-ochre transition hover:underline"
                            title="Open entry"
                            onClick={() => openAnimeSheet(g.anilistId, "ANIME", true)}
                          >
                            {g.title ?? `#${g.anilistId}`}
                          </button>
                          <span className="font-mono text-[9.5px] text-fg-faint tnum">
                            {g.days}d
                          </span>
                          <button
                            className="flex items-center gap-0.5 text-accent transition hover:brightness-125 disabled:opacity-40"
                            title={`Search for ep ${g.progress + 1} now`}
                            disabled={searchingId === g.anilistId}
                            onClick={() => void retryFresh(g.anilistId, g.progress, g.title)}
                          >
                            {searchingId === g.anilistId ? (
                              <Loader2 size={9} className="animate-spin" />
                            ) : (
                              <Search size={9} />
                            )}
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <Radar size={26} strokeWidth={1} className="shrink-0 text-ochre/30" />
                </div>
              )}

              <div className="flex h-full min-h-[520px] min-w-max gap-2.5">
                {grouped.map((day, di) => {
                  const isToday = di === 0;
                  return (
                    <div
                      key={day.label}
                      className="flex w-56 shrink-0 flex-col overflow-hidden border border-edge bg-surface-2/30"
                    >
                      <div
                        className={`flex items-center justify-between border-b border-edge px-2.5 py-1.5 ${
                          isToday ? "bg-accent/10" : ""
                        }`}
                      >
                        <div className={`label-caps ${isToday ? "!text-accent" : ""}`}>
                          {day.label}
                          {isToday && " · today"}
                        </div>
                        <span className="font-mono text-[10px] text-fg-faint tnum">
                          {day.count}
                        </span>
                      </div>
                      <div className="flex-1 space-y-2 overflow-y-auto p-2">
                        {day.hours.length === 0 && (
                          <div className="px-2 py-3 text-center font-mono text-[10px] text-fg-faint">
                            nothing airs
                          </div>
                        )}
                        {day.hours.map((hg) => (
                          <div key={hg.hour}>
                            <div className="mb-1 flex items-center gap-1.5 px-0.5 font-mono text-[10px] text-fg-faint tnum">
                              <Clock size={10} strokeWidth={1.75} />
                              {hg.hour}
                            </div>
                            <div className="space-y-1.5">
                              {hg.items.map((item) => {
                                const released = item.airingAt * 1000 <= now;
                                const rels = item.releases.filter((r) => r.seen === 0);
                                return (
                                  <div
                                    key={`${item.anilistId}:${item.episode}`}
                                    className="group cursor-pointer border border-edge bg-surface transition-colors hover:border-edge-2"
                                    onClick={() =>
                                      item.entryId != null
                                        ? openEntrySheet(item.entryId)
                                        : openAnimeSheet(item.anilistId, "ANIME", true)
                                    }
                                  >
                                    <div className="flex gap-2 p-1.5">
                                      <Cover
                                        anilistId={item.anilistId}
                                        coverUrl={item.coverUrl}
                                        title={item.titleRomaji}
                                        className="h-16 w-11 shrink-0 overflow-hidden rounded-[2px] border border-edge/70"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="line-clamp-2 text-[11.5px] font-semibold leading-tight">
                                          {item.titleRomaji}
                                          <span className="ml-1 bg-accent/15 px-1 font-mono text-[9px] font-semibold text-accent tnum">
                                            ep {item.episode}
                                          </span>
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1 font-mono text-[9.5px]">
                                          {released ? (
                                            <span className="font-semibold text-moss">
                                              {rels.length > 0
                                                ? `${rels.length} release${rels.length === 1 ? "" : "s"}!`
                                                : "released"}
                                            </span>
                                          ) : (
                                            <span className="text-accent">
                                              in {fmtCountdown(item.airingAt)}
                                            </span>
                                          )}
                                        </div>
                                        {item.inList ? (
                                          <span className="mt-0.5 inline-flex items-center gap-1">
                                            <span className="bg-surface-2 px-1 font-mono text-[9px] text-fg-faint">
                                              in list
                                              {item.entryProgress != null
                                                ? ` · ep ${item.entryProgress}`
                                                : ""}
                                            </span>
                                            {item.entryStatus === "CURRENT" &&
                                              item.entryProgress != null &&
                                              item.episode - 1 - item.entryProgress >= 2 && (
                                                <span
                                                  className="bg-ochre/15 px-1 font-mono text-[9px] font-semibold text-ochre tnum"
                                                  title={`Episodes ${item.entryProgress + 1}-${item.episode - 1} already aired`}
                                                >
                                                  {item.episode - 1 - item.entryProgress} behind
                                                </span>
                                              )}
                                          </span>
                                        ) : (
                                          <span className="mt-0.5 inline-flex items-center gap-0.5 bg-surface-2 px-1 py-0.5 font-mono text-[9px] text-fg-faint">
                                            <Plus size={8} />
                                            not in list
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {(rels.length > 0 || released) && item.inList && (
                                      <div
                                        className="space-y-1 border-t border-edge bg-surface-2/40 px-1.5 py-1"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {rels.slice(0, 2).map((r) => (
                                          <div key={r.id} className="flex items-center gap-1.5">
                                            <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-fg-faint">
                                              {r.size ?? ""}
                                              {r.seeders > 0 && (
                                                <span className="text-moss"> · {r.seeders}s</span>
                                              )}
                                            </span>
                                            {r.magnet && (
                                              <>
                                                <IconBtn
                                                  title="Add to watch queue"
                                                  className="!h-5 !w-5 border border-edge bg-surface"
                                                  onClick={() =>
                                                    void queueMagnet(
                                                      `${item.titleRomaji ?? "Anime"} — ep ${item.episode}`,
                                                      r.magnet!,
                                                      r.size,
                                                      item.entryId,
                                                      item.episode,
                                                    )
                                                  }
                                                >
                                                  <ListPlus size={10} strokeWidth={1.75} />
                                                </IconBtn>
                                                <IconBtn
                                                  title="Play in the built-in player"
                                                  className="!h-5 !w-5 bg-accent text-white hover:!bg-accent hover:!text-white"
                                                  onClick={() =>
                                                    openMpv(
                                                      r.magnet!,
                                                      item.entryId,
                                                      r.episode,
                                                      item.titleRomaji,
                                                    )
                                                  }
                                                >
                                                  <Magnet size={10} strokeWidth={1.75} />
                                                </IconBtn>
                                              </>
                                            )}
                                          </div>
                                        ))}
                                        {released && rels.length === 0 && item.searched && (
                                          <div className="flex items-center gap-1 font-mono text-[9.5px] text-fg-faint">
                                            <CheckCircle2 size={9} strokeWidth={1.75} />
                                            searched, none matched
                                            <button
                                              className="ml-auto flex items-center gap-0.5 bg-surface px-1 py-0.5 font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
                                              onClick={() => searchNow(item)}
                                              disabled={searchingId === item.anilistId}
                                            >
                                              {searchingId === item.anilistId ? (
                                                <Loader2 size={8} className="animate-spin" />
                                              ) : (
                                                <Search size={8} />
                                              )}
                                              retry
                                            </button>
                                          </div>
                                        )}
                                        {released && rels.length === 0 && !item.searched && (
                                          <div className="flex items-center gap-1 font-mono text-[9.5px] text-fg-faint">
                                            <Loader2 size={9} className="animate-spin" />
                                            will search soon…
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
