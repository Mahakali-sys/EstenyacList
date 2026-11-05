import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  Clock,
  Flame,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  Tv,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { ActivityDay, EntryView } from "../lib/types";
import { DEFAULT_TIME_ZONE, statusLabel, todayInZone } from "../lib/types";
import { Bar, EmptyState, IconBtn, Label, Seg } from "../components/ui";
import { useStore } from "../store";

type Scope = "all" | "ANIME" | "MANGA";

const DEFAULT_MINUTES_PER_EP = 24;
const HEAT_WEEKS = 26;

// Activity days are calendar dates recorded by the backend in the selected
// timezone. Treating those dates as UTC midnights keeps the heatmap aligned
// with the calendar regardless of the machine's own timezone or DST.
const DAY_MS = 86_400_000;

function yearMonthInZone(timeZone: string): [number, number] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return [value("year"), value("month")];
}

function dayStr(dayStart: number): string {
  const d = new Date(dayStart);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function fmtHours(h: number): string {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k`;
  return h >= 100 ? Math.round(h).toString() : h.toFixed(1);
}

const STATUS_SEGMENTS = ["CURRENT", "COMPLETED", "PLANNING", "PAUSED", "DROPPED"] as const;
const STATUS_COLORS: Record<string, string> = {
  CURRENT: "var(--accent)",
  COMPLETED: "var(--moss)",
  PLANNING: "var(--fg-faint)",
  PAUSED: "var(--ochre)",
  DROPPED: "var(--danger)",
};

export function StatsPage() {
  const timeZone = useStore((s) => s.settings.timeZone ?? DEFAULT_TIME_ZONE);
  const [entries, setEntries] = useState<EntryView[] | null>(null);
  const [activity, setActivity] = useState<ActivityDay[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .getEntries()
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
    api.getActivity().then(setActivity).catch(() => {});
  };

  useEffect(load, []);

  const scoped = useMemo(
    () => (entries ?? []).filter((e) => scope === "all" || e.mediaType === scope),
    [entries, scope],
  );

  const stats = useMemo(() => {
    const total = scoped.length;
    const byStatus = new Map<string, number>();
    for (const e of scoped) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);

    const episodes = scoped
      .filter((e) => e.mediaType === "ANIME")
      .reduce((a, e) => a + e.progress, 0);
    const chapters = scoped
      .filter((e) => e.mediaType === "MANGA")
      .reduce((a, e) => a + e.progress, 0);
    const minutes = scoped.reduce(
      (a, e) =>
        a +
        (e.mediaType === "MANGA"
          ? 0
          : e.progress * ((e.duration ?? DEFAULT_MINUTES_PER_EP) || DEFAULT_MINUTES_PER_EP)),
      0,
    );
    const hours = minutes / 60;

    const scored = scoped.filter((e) => e.score > 0);
    const avgScore = scored.length
      ? scored.reduce((a, e) => a + e.score, 0) / scored.length
      : 0;

    const histogram = Array.from({ length: 10 }, (_, i) => ({
      score: i + 1,
      count: scored.filter((e) => e.score === i + 1).length,
    }));

    const genres = new Map<string, number>();
    for (const e of scoped) {
      if (!e.genres) continue;
      for (const g of e.genres.split(",")) {
        const t = g.trim();
        if (t) genres.set(t, (genres.get(t) ?? 0) + 1);
      }
    }
    const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

    const seasons = new Map<string, { total: number; completed: number }>();
    for (const e of scoped) {
      if (!e.seasonYear) continue;
      const key = `${(e.season ?? "—").toUpperCase()} ${e.seasonYear}`;
      const cur = seasons.get(key) ?? { total: 0, completed: 0 };
      cur.total += 1;
      if (e.status === "COMPLETED") cur.completed += 1;
      seasons.set(key, cur);
    }
    const topSeasons = [...seasons.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
      .slice(0, 8);

    const formats = new Map<string, number>();
    for (const e of scoped) {
      const f = e.format ?? "—";
      formats.set(f, (formats.get(f) ?? 0) + 1);
    }
    const topFormats = [...formats.entries()].sort((a, b) => b[1] - a[1]);

    const months: { key: string; label: string; count: number }[] = [];
    const [nowYear, nowMonth] = yearMonthInZone(timeZone);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(nowYear, nowMonth - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      months.push({
        key,
        label: d
          .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
          .replace(".", ""),
        count: scoped.filter((e) => (e.finishDate ?? "").startsWith(key)).length,
      });
    }

    const completed = scoped.filter((e) => e.status === "COMPLETED");
    const longest = [...scoped].sort((a, b) => b.progress - a.progress)[0];
    const bestRated = [...completed]
      .filter((e) => e.averageScore != null)
      .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))[0];
    const recentFinish = [...completed]
      .filter((e) => e.finishDate && !e.finishDate.startsWith("0000"))
      .sort((a, b) => (a.finishDate! < b.finishDate! ? 1 : -1))[0];
    const longestRunning = [...scoped]
      .filter((e) => e.status === "CURRENT" && e.startDate && !e.startDate.startsWith("0000"))
      .sort((a, b) => (a.startDate! > b.startDate! ? 1 : -1))[0];

    return {
      total,
      byStatus,
      episodes,
      chapters,
      hours,
      avgScore,
      scoredCount: scored.length,
      histogram,
      topGenres,
      topSeasons,
      topFormats,
      months,
      completed: completed.length,
      rewatches: scoped.reduce((a, e) => a + e.rewatches, 0),
      longest,
      bestRated,
      recentFinish,
      longestRunning,
      animeOnly: scope === "ANIME",
      mangaOnly: scope === "MANGA",
    };
  }, [scoped, timeZone]);

  const heat = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of activity) {
      if (scope !== "all" && a.mediaType !== scope) continue;
      map.set(a.day, (map.get(a.day) ?? 0) + a.count);
    }
    const today = Date.parse(`${todayInZone(timeZone)}T00:00:00Z`);
    const mondayOffset = (new Date(today).getUTCDay() + 6) % 7;
    const start = today - (mondayOffset + (HEAT_WEEKS - 1) * 7) * DAY_MS;

    const weeks: { day: string; count: number; future: boolean }[][] = [];
    const monthLabels: string[] = [];
    let lastMonth = -1;
    for (let w = 0; w < HEAT_WEEKS; w++) {
      const week: { day: string; count: number; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const cur = start + (w * 7 + d) * DAY_MS;
        const key = dayStr(cur);
        week.push({ day: key, count: map.get(key) ?? 0, future: cur > today });
      }
      weeks.push(week);
      const monday = new Date(start + w * 7 * DAY_MS);
      if (monday.getUTCMonth() !== lastMonth) {
        lastMonth = monday.getUTCMonth();
        monthLabels.push(
          monday
            .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
            .replace(".", ""),
        );
      } else {
        monthLabels.push("");
      }
    }

    const activeKeys = [...map.entries()]
      .filter(([, c]) => c > 0)
      .map(([d]) => d)
      .sort();
    const activeSet = new Set(activeKeys);

    let current = 0;
    let cursor = today;
    if (!activeSet.has(dayStr(cursor))) cursor -= DAY_MS;
    while (activeSet.has(dayStr(cursor))) {
      current += 1;
      cursor -= DAY_MS;
    }

    let best = 0;
    let run = 0;
    for (let i = 0; i < activeKeys.length; i++) {
      if (i > 0) {
        const prev = Date.parse(`${activeKeys[i - 1]}T00:00:00Z`) + DAY_MS;
        run = dayStr(prev) === activeKeys[i] ? run + 1 : 1;
      } else {
        run = 1;
      }
      best = Math.max(best, run);
    }

    return {
      weeks,
      monthLabels,
      current,
      best,
      activeDays: activeKeys.length,
      total: [...map.values()].reduce((a, b) => a + b, 0),
    };
  }, [activity, scope, timeZone]);

  const donePct = stats.total
    ? Math.round((stats.completed / stats.total) * 100)
    : 0;
  const maxHist = Math.max(1, ...stats.histogram.map((h) => h.count));
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count));
  const maxGenre = Math.max(1, ...(stats.topGenres.map((g) => g[1]) ?? [1]));
  const segTotal = Math.max(
    1,
    STATUS_SEGMENTS.reduce((a, s) => a + (stats.byStatus.get(s) ?? 0), 0),
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="mx-auto max-w-5xl pb-8">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <div className="flex items-baseline gap-2">
            <BarChart3 size={14} className="self-center text-accent" strokeWidth={1.75} />
            <h1 className="display text-[17px] font-semibold">Statistics</h1>
            <span className="font-mono text-[10px] text-fg-faint">your list, measured</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Seg<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { id: "all", label: "All" },
                { id: "ANIME", label: "Anime" },
                { id: "MANGA", label: "Manga" },
              ]}
            />
            <IconBtn title="Recalculate" onClick={load}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </IconBtn>
          </div>
        </div>

        {entries === null ? (
          <div className="flex items-center justify-center gap-2 py-24">
            <Loader2 size={18} className="animate-spin text-accent" />
            <span className="font-mono text-[11px] text-fg-muted">
              crunching your library…
            </span>
          </div>
        ) : stats.total === 0 ? (
          <EmptyState
            icon={<BarChart3 size={26} strokeWidth={1.5} />}
            title="Nothing to measure yet"
            sub="Track some titles and they'll show up here."
          />
        ) : (
          <>
            {/* hero ledger */}
            <div className="border border-edge bg-surface-2/30 p-5">
              <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
                <div className="grid flex-1 grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
                  <HeroStat
                    icon={<Sparkles size={11} strokeWidth={1.75} />}
                    label="titles tracked"
                    value={stats.total.toString()}
                  />
                  {!stats.animeOnly && (
                    <HeroStat
                      icon={<BookOpen size={11} strokeWidth={1.75} />}
                      label="chapters read"
                      value={stats.chapters.toLocaleString("en-US")}
                    />
                  )}
                  {!stats.mangaOnly && (
                    <>
                      <HeroStat
                        icon={<Tv size={11} strokeWidth={1.75} />}
                        label="episodes watched"
                        value={stats.episodes.toLocaleString("en-US")}
                      />
                      <HeroStat
                        icon={<Clock size={11} strokeWidth={1.75} />}
                        label="time in front of mpv"
                        value={`${fmtHours(stats.hours)} h`}
                        sub={`${(stats.hours / 24).toFixed(1)} days`}
                      />
                    </>
                  )}
                  <HeroStat
                    icon={<Star size={11} strokeWidth={1.75} />}
                    label="avg. given score"
                    value={stats.avgScore > 0 ? stats.avgScore.toFixed(1) : "—"}
                    sub={`${stats.scoredCount} scored`}
                  />
                  <HeroStat
                    icon={<Trophy size={11} strokeWidth={1.75} />}
                    label="completed"
                    value={`${stats.completed}`}
                  />
                  {stats.rewatches > 0 && (
                    <HeroStat
                      icon={<RotateCcw size={11} strokeWidth={1.75} />}
                      label={stats.mangaOnly ? "rereads" : "rewatches"}
                      value={stats.rewatches.toLocaleString("en-US")}
                    />
                  )}
                </div>
                <div className="w-44 shrink-0">
                  <div className="label-caps">completion</div>
                  <div className="display mt-1 text-[34px] font-semibold leading-none tnum">
                    {donePct}%
                  </div>
                  <Bar pct={donePct} className="mt-2.5" />
                  <div className="mt-1.5 font-mono text-[9.5px] text-fg-faint tnum">
                    {stats.completed} of {stats.total} titles
                  </div>
                </div>
              </div>
            </div>

            {/* activity heatmap */}
            <div className="mt-2.5 border border-edge bg-surface-2/30 p-4">
              <Label
                right={
                  <span className="flex items-center gap-2 font-mono text-[9.5px] text-fg-faint tnum">
                    <Flame size={10} strokeWidth={1.75} className="text-accent" />
                    <span>
                      {heat.current}d current · {heat.best}d best ·{" "}
                      {heat.activeDays} active days
                    </span>
                  </span>
                }
              >
                activity heatmap
              </Label>
              <div className="mt-3 overflow-x-auto pb-1">
                <div className="flex min-w-max gap-[3px]">
                  {heat.weeks.map((_, i) => (
                    <div key={i} className="w-[11px] shrink-0">
                      {heat.monthLabels[i] && (
                        <span className="relative -left-px block whitespace-nowrap font-mono text-[8px] capitalize text-fg-faint">
                          {heat.monthLabels[i]}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex min-w-max gap-[3px]">
                  {heat.weeks.map((week, i) => (
                    <div key={i} className="flex flex-col gap-[3px]">
                      {week.map((cell) => (
                        <div
                          key={cell.day}
                          className="h-[11px] w-[11px]"
                          style={{
                            background: cell.future
                              ? "transparent"
                              : heatColor(cell.count),
                          }}
                          title={
                            cell.future
                              ? undefined
                              : `${cell.day}: ${cell.count} ${
                                  cell.count === 1 ? "unit" : "units"
                                }`
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[9px] text-fg-faint tnum">
                  {heat.total.toLocaleString("en-US")} units logged in{" "}
                  {HEAT_WEEKS} weeks
                </span>
                <span className="flex items-center gap-1 font-mono text-[8.5px] text-fg-faint">
                  less
                  {[0, 1, 2, 3, 4].map((n) => (
                    <span
                      key={n}
                      className="h-[8px] w-[8px]"
                      style={{ background: heatColor(n) }}
                    />
                  ))}
                  more
                </span>
              </div>
            </div>

            <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
              {/* status distribution */}
              <div className="border border-edge bg-surface-2/30 p-4 md:col-span-2">
                <Label>status distribution</Label>
                <div className="mt-3 flex h-2 w-full">
                  {STATUS_SEGMENTS.map((s) => {
                    const n = stats.byStatus.get(s) ?? 0;
                    return (
                      <div
                        key={s}
                        className="anim-bar-x h-full"
                        style={{
                          width: `${(n / segTotal) * 100}%`,
                          background: STATUS_COLORS[s],
                          animationDelay: "80ms",
                        }}
                        title={`${statusLabel(s, false)}: ${n}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {STATUS_SEGMENTS.map((s) => {
                    const n = stats.byStatus.get(s) ?? 0;
                    return (
                      <span key={s} className="flex items-center gap-1.5 font-mono text-[10px] text-fg-muted">
                        <span
                          className="h-2 w-2"
                          style={{ background: STATUS_COLORS[s] }}
                        />
                        {statusLabel(s, scope === "MANGA")}
                        <b className="text-fg tnum">{n}</b>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* score histogram */}
              <div className="border border-edge bg-surface-2/30 p-4">
                <Label>score histogram</Label>
                <div className="mt-4 flex h-32 items-end gap-1 border-b border-edge pb-px">
                  {stats.histogram.map((h, i) => (
                    <div
                      key={h.score}
                      className="flex min-w-0 flex-1 flex-col items-center gap-1"
                    >
                      <span className="font-mono text-[9px] text-fg-faint tnum">
                        {h.count > 0 ? h.count : ""}
                      </span>
                      <div
                        className="anim-bar-y w-full"
                        style={{
                          height: `${Math.max(3, (h.count / maxHist) * 100)}%`,
                          background:
                            h.count === 0
                              ? "var(--edge)"
                              : h.score === 10
                                ? "var(--accent)"
                                : "color-mix(in srgb, var(--accent) 55%, transparent)",
                          animationDelay: `${i * 35}ms`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-1">
                  {stats.histogram.map((h) => (
                    <span
                      key={h.score}
                      className="flex-1 text-center font-mono text-[9.5px] text-fg-faint tnum"
                    >
                      {h.score}
                    </span>
                  ))}
                </div>
              </div>

              {/* formats */}
              <div className="border border-edge bg-surface-2/30 p-4">
                <Label>formats</Label>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {stats.topFormats.map(([f, n], i) => (
                    <span
                      key={f}
                      className={`chip ${i === 0 ? "chip-accent" : ""}`}
                    >
                      {f} <span className="opacity-60 tnum">· {n}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-4 border-t border-edge pt-3">
                  <div className="label-caps">busiest finishing month</div>
                  {(() => {
                    const best = stats.months.reduce((a, b) => (b.count > a.count ? b : a));
                    return best.count === 0 ? (
                      <div className="mt-1 font-mono text-[10.5px] text-fg-faint">
                        nothing finished yet
                      </div>
                    ) : (
                      <div className="mt-1 text-[13px] font-semibold capitalize">
                        {best.label}{" "}
                        <span className="font-mono text-[10px] font-normal text-fg-faint tnum">
                          · {best.count} titles
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* activity */}
              <div className="border border-edge bg-surface-2/30 p-4 md:col-span-2">
                <Label
                  right={
                    <span className="font-mono text-[9.5px] text-fg-faint">
                      last 12 months
                    </span>
                  }
                >
                  finished per month
                </Label>
                <div className="mt-4 flex h-28 items-end gap-2 border-b border-edge pb-px">
                  {stats.months.map((m, i) => (
                    <div
                      key={m.key}
                      className="flex min-w-0 flex-1 flex-col items-center gap-1"
                    >
                      <span className="font-mono text-[9px] text-fg-faint tnum">
                        {m.count > 0 ? m.count : ""}
                      </span>
                      <div
                        className="anim-bar-y w-full"
                        style={{
                          height: `${Math.max(2, (m.count / maxMonth) * 100)}%`,
                          background:
                            m.count === 0
                              ? "var(--edge)"
                              : i === stats.months.length - 1
                                ? "var(--accent)"
                                : "color-mix(in srgb, var(--accent) 55%, transparent)",
                          animationDelay: `${i * 30}ms`,
                        }}
                        title={`${m.count} in ${m.key}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-2">
                  {stats.months.map((m, i) => (
                    <span
                      key={m.key}
                      className="flex-1 truncate text-center font-mono text-[9.5px] capitalize text-fg-faint"
                    >
                      {i === stats.months.length - 1 ? "now" : m.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* seasons */}
              <div className="border border-edge bg-surface-2/30 p-4 md:col-span-2">
                <Label
                  right={
                    <span className="font-mono text-[9.5px] text-fg-faint">
                      by season year · completed in tooltip
                    </span>
                  }
                >
                  season breakdown
                </Label>
                {stats.topSeasons.length === 0 ? (
                  <div className="mt-3 font-mono text-[10.5px] text-fg-faint">
                    no season data
                  </div>
                ) : (
                  <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 md:grid-cols-4">
                    {stats.topSeasons.map(([key, v], i) => (
                      <div
                        key={key}
                        className="flex items-center gap-2"
                        title={`${v.completed} completed of ${v.total}`}
                      >
                        <span className="w-[88px] shrink-0 truncate font-mono text-[9.5px] uppercase tracking-wide text-fg-muted">
                          {key}
                        </span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden bg-surface-2">
                          <div
                            className="anim-bar-x h-full"
                            style={{
                              width: `${(v.total / Math.max(1, ...stats.topSeasons.map(([, x]) => x.total))) * 100}%`,
                              background: "var(--accent)",
                              opacity: 1 - i * 0.06,
                              animationDelay: `${i * 35}ms`,
                            }}
                          />
                        </div>
                        <span className="w-5 shrink-0 text-right font-mono text-[10px] text-fg-faint tnum">
                          {v.total}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* genres */}
              <div className="border border-edge bg-surface-2/30 p-4">
                <Label>top genres</Label>
                <div className="mt-3 space-y-2">
                  {stats.topGenres.length === 0 && (
                    <div className="font-mono text-[10.5px] text-fg-faint">
                      no genre data
                    </div>
                  )}
                  {stats.topGenres.map(([g, n], i) => (
                    <div key={g} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-right text-[10.5px] text-fg-muted">
                        {g}
                      </span>
                      <div className="h-2.5 min-w-0 flex-1 overflow-hidden bg-surface-2">
                        <div
                          className="anim-bar-x h-full"
                          style={{
                            width: `${(n / maxGenre) * 100}%`,
                            background: "var(--accent)",
                            opacity: 1 - i * 0.07,
                            animationDelay: `${i * 45}ms`,
                          }}
                        />
                      </div>
                      <span className="w-7 shrink-0 text-right font-mono text-[10px] text-fg-faint tnum">
                        {n}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* highlights */}
              <div className="border border-edge bg-surface-2/30 p-4">
                <Label
                  right={<Flame size={11} strokeWidth={1.75} className="text-accent" />}
                >
                  highlights
                </Label>
                <div className="mt-3 space-y-2.5">
                  <Highlight
                    icon={<Tv size={11} strokeWidth={1.75} />}
                    label="longest grind"
                    value={stats.longest?.title ?? null}
                    sub={
                      stats.longest
                        ? `${stats.longest.progress} ${stats.longest.mediaType === "MANGA" ? "chapters" : "episodes"}`
                        : undefined
                    }
                  />
                  <Highlight
                    icon={<Star size={11} strokeWidth={1.75} />}
                    label="community favorite (finished)"
                    value={stats.bestRated?.title ?? null}
                    sub={
                      stats.bestRated ? `${stats.bestRated.averageScore}% on AniList` : undefined
                    }
                  />
                  <Highlight
                    icon={<CalendarCheck size={11} strokeWidth={1.75} />}
                    label="last finished"
                    value={stats.recentFinish?.title ?? null}
                    sub={stats.recentFinish?.finishDate ?? undefined}
                  />
                  <Highlight
                    icon={<Clock size={11} strokeWidth={1.75} />}
                    label="longest open chapter"
                    value={stats.longestRunning?.title ?? null}
                    sub={
                      stats.longestRunning ? `started ${stats.longestRunning.startDate}` : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function heatColor(count: number): string {
  if (count <= 0) return "var(--surface-2)";
  if (count === 1)
    return "color-mix(in srgb, var(--accent) 30%, var(--surface-2))";
  if (count === 2)
    return "color-mix(in srgb, var(--accent) 55%, var(--surface-2))";
  if (count === 3)
    return "color-mix(in srgb, var(--accent) 80%, var(--surface-2))";
  return "var(--accent)";
}

function HeroStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="label-caps flex items-center gap-1.5">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
      <div className="display mt-0.5 text-[26px] font-semibold leading-tight tnum">
        {value}
      </div>
      {sub && <div className="font-mono text-[9.5px] text-fg-faint">{sub}</div>}
    </div>
  );
}

function Highlight({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border border-edge bg-surface text-accent">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="label-caps">{label}</div>
        {value == null ? (
          <div className="truncate font-mono text-[11px] text-fg-faint">—</div>
        ) : (
          <>
            <div className="truncate text-[12.5px] font-semibold" title={value}>
              {value}
            </div>
            {sub && (
              <div className="font-mono text-[9.5px] text-fg-faint">{sub}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
