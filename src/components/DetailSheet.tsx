import { Calendar, Loader2, Magnet, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  DEFAULT_TIME_ZONE,
  STATUSES,
  statusLabel,
  todayInZone,
} from "../lib/types";
import type { EntryView, NekoGroup, ReleaseRow } from "../lib/types";
import { useStore } from "../store";
import { ChipsInput } from "./ChipsInput";
import { Cover } from "./Cover";
import { GroupPicker } from "./GroupPicker";
import { ProgressEdit } from "./ProgressEdit";
import { ReleaseList } from "./ReleaseList";
import { ScorePicker } from "./ScorePicker";
import { Btn, IconBtn, Label, useEscape } from "./ui";

function Section({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 border-t border-edge pt-3.5">
      <Label right={right}>{label}</Label>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`btn btn-sm ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "btn-outline text-fg-muted"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DetailSheet() {
  const sheet = useStore((s) => s.sheet);
  const closeSheet = useStore((s) => s.closeSheet);
  const toast = useStore((s) => s.toast);
  const customLists = useStore((s) => s.customLists);
  const loadCustomLists = useStore((s) => s.loadCustomLists);
  const removeEntry = useStore((s) => s.removeEntry);
  const removeEntryLocal = useStore((s) => s.removeEntryLocal);
  const loadSchedule = useStore((s) => s.loadSchedule);
  const timeZone = useStore((s) => s.settings.timeZone ?? DEFAULT_TIME_ZONE);

  const [entry, setEntry] = useState<EntryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [searchingRelease, setSearchingRelease] = useState(false);
  const [addStatus, setAddStatus] = useState<string>("CURRENT");
  const [addCustom, setAddCustom] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [mediaGroups, setMediaGroups] = useState<[string[], string[]]>([[], []]);
  const [searchNames, setSearchNames] = useState<string[]>([]);
  const [releaseFilters, setReleaseFilters] = useState<string[]>([]);
  const [qualityPrefs, setQualityPrefs] = useState<string[]>([]);
  const [epInput, setEpInput] = useState("");
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [groupResults, setGroupResults] = useState<NekoGroup[] | null>(null);
  const [searchingGroups, setSearchingGroups] = useState(false);

  const open = sheet.entryId != null || sheet.anilistId != null;
  useEscape(open, closeSheet);

  const isEntrySheet = sheet.entryId != null;
  const manga = sheet.mediaType === "MANGA";

  useEffect(() => {
    loadCustomLists();
    if (sheet.entryId != null) {
      setLoading(true);
      api
        .getEntry(sheet.entryId)
        .then((e) => {
          setEntry(e);
          setEpInput(String(e.progress + 1));
          if (e.mediaType === "ANIME") {
            api.getReleases(e.anilistId).then(setReleases);
            api.getMediaGroups(e.anilistId).then(([inc, exc]) => {
              setMediaGroups([inc, exc]);
              const g = useStore.getState().settings.nekoGroupNames ?? {};
              setGroupNames((prev) => ({ ...g, ...prev }));
            });
            api.getSearchNames(e.anilistId).then(setSearchNames);
            api.getReleaseFilters(e.anilistId).then(setReleaseFilters);
            api.getQualityPrefs(e.anilistId).then(setQualityPrefs);
          }
        })
        .catch((err) => toast(String(err), "error"))
        .finally(() => setLoading(false));
    } else {
      setEntry(null);
      setReleases([]);
    }
  }, [sheet.entryId, sheet.anilistId, loadCustomLists, toast]);

  if (!open) return null;

  const patch = async (p: {
    status?: string;
    customListId?: number;
    score?: number;
    progress?: number;
    rewatches?: number;
    startDate?: string;
    finishDate?: string;
    notes?: string;
  }) => {
    if (!entry) return;
    const updated = await useStore
      .getState()
      .updateEntry({ id: entry.id, ...p });
    setEntry(updated);
  };

  const doRemove = async () => {
    if (!entry) return;
    await removeEntry(entry.id);
    removeEntryLocal(entry.id);
    toast("Removed from list", "success");
    closeSheet();
  };

  const searchRelease = async () => {
    if (!entry) return;
    setSearchingRelease(true);
    try {
      const ep = Math.max(1, Math.floor(Number(epInput)) || entry.progress + 1);
      const found = await api.searchReleasesNow(entry.anilistId, ep);
      setReleases(await api.getReleases(entry.anilistId));
      toast(
        found
          ? `Found ${found} release(s) for ep ${ep}`
          : `No releases found for ep ${ep} (check filters)`,
        found ? "success" : "info",
      );
      loadSchedule();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearchingRelease(false);
    }
  };

  const clearReleases = async () => {
    if (!entry) return;
    try {
      await api.clearReleases(entry.anilistId);
      setReleases([]);
      toast("Found releases cleared", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const searchGroups = async (query: string) => {
    if (!entry) return;
    setSearchingGroups(true);
    try {
      setGroupResults(await api.nekoSearchGroups(query));
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearchingGroups(false);
    }
  };

  const saveGroups = (pair: [string[], string[]]) => {
    if (!entry) return;
    setMediaGroups(pair);
    api
      .setMediaGroups(entry.anilistId, pair[0], pair[1])
      .catch((e) => toast(String(e), "error"));
  };

  const toggleGroup = (list: "include" | "exclude", g: NekoGroup) => {
    if (!entry) return;
    const idx = list === "include" ? 0 : 1;
    const cur = mediaGroups[idx];
    const next = cur.includes(g.id)
      ? cur.filter((x) => x !== g.id)
      : [...cur, g.id];
    const nextPair: [string[], string[]] =
      idx === 0 ? [next, mediaGroups[1]] : [mediaGroups[0], next];
    const names = { ...groupNames, [g.id]: g.displayName };
    setGroupNames(names);
    // persist id→name so Nyaa title-tag matching knows the display name too
    useStore.getState().setSetting("nekoGroupNames", names);
    saveGroups(nextPair);
  };

  const removeGroup = (list: "include" | "exclude", id: string) => {
    const idx = list === "include" ? 0 : 1;
    const next = mediaGroups[idx].filter((x) => x !== id);
    saveGroups(idx === 0 ? [next, mediaGroups[1]] : [mediaGroups[0], next]);
  };

  const saveSearchNames = (next: string[]) => {
    if (!entry) return;
    setSearchNames(next);
    api.setSearchNames(entry.anilistId, next).catch((e) => toast(String(e), "error"));
  };

  const saveReleaseFilters = (next: string[]) => {
    if (!entry) return;
    const lowered = next.map((x) => x.toLowerCase());
    setReleaseFilters(lowered);
    api.setReleaseFilters(entry.anilistId, lowered).catch((e) => toast(String(e), "error"));
  };

  const saveQualityPrefs = (next: string[]) => {
    if (!entry) return;
    const lowered = next.map((x) => x.toLowerCase());
    setQualityPrefs(lowered);
    api.setQualityPrefs(entry.anilistId, lowered).catch((e) => toast(String(e), "error"));
  };

  const openMpv = async (magnet: string, episode: number) => {
    const ok = await useStore
      .getState()
      .playerPlay(magnet, entry?.title ?? null, entry?.id ?? null, episode);
    // the player bar sits below the sheet, so a successful play should reveal it
    if (ok) closeSheet();
  };

  const queueMagnet = async (
    label: string,
    magnet: string,
    size?: string | null,
    episode?: number | null,
  ) => {
    try {
      await useStore
        .getState()
        .queueAdd(label, magnet, size ?? undefined, entry?.id ?? null, episode ?? null);
      toast("Added to watch queue", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const addFromSchedule = async () => {
    if (sheet.anilistId == null || sheet.entryId != null || adding) return;
    setAdding(true);
    try {
      const created = await api.addEntry(sheet.anilistId, sheet.mediaType, addStatus);
      if (addCustom != null && created?.id) {
        await api.updateEntry({ id: created.id, customListId: addCustom });
      }
      toast("Added to your list", "success");
      closeSheet();
      await useStore.getState().refreshEntries(sheet.mediaType);
      loadSchedule();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55" onClick={closeSheet} />
      <div className="anim-sheet absolute right-0 top-0 flex h-full w-[452px] max-w-full flex-col border-l border-edge bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <div className="label-caps">
            {isEntrySheet
              ? entry?.mediaType === "MANGA"
                ? "manga entry"
                : "anime entry"
              : "add to your list"}
          </div>
          <IconBtn title="Close (Esc)" onClick={closeSheet}>
            <X size={15} />
          </IconBtn>
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="animate-spin text-accent" size={26} />
          </div>
        )}

        {!loading && isEntrySheet && entry && (
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <div className="flex gap-4 pt-4">
              <Cover
                anilistId={entry.anilistId}
                coverUrl={entry.coverUrl}
                title={entry.title}
                className="h-[168px] w-[112px] shrink-0 overflow-hidden rounded-[3px] border border-edge shadow-sm"
              />
              <div className="min-w-0">
                <div className="display text-[17px] font-semibold leading-snug">
                  {entry.title}
                </div>
                {entry.titleEnglish && entry.titleEnglish !== entry.title && (
                  <div className="mt-1 line-clamp-2 text-[11px] text-fg-muted">
                    {entry.titleEnglish}
                  </div>
                )}
                {entry.titleNative && (
                  <div className="mt-0.5 text-[11px] text-fg-faint">
                    {entry.titleNative}
                  </div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="chip">{entry.format ?? "—"}</span>
                  {entry.seasonYear && (
                    <span className="chip">
                      {entry.season ? `${entry.season} ` : ""}
                      {entry.seasonYear}
                    </span>
                  )}
                  {entry.averageScore != null && (
                    <span
                      className="chip"
                      style={{
                        color: "var(--ochre)",
                        borderColor: "color-mix(in srgb, var(--ochre) 40%, transparent)",
                      }}
                      title="AniList community score"
                    >
                      {entry.averageScore}%
                    </span>
                  )}
                  <span className="chip">{entry.mediaStatus ?? "—"}</span>
                </div>
                {entry.genres && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entry.genres.split(",").map((g) => (
                      <span key={g} className="chip chip-accent">
                        {g.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Section label="status">
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <Choice
                    key={s}
                    active={entry.status === s}
                    onClick={() =>
                      patch(
                        s === "COMPLETED" && !entry.finishDate
                          ? {
                              status: s,
                              finishDate: todayInZone(timeZone),
                            }
                          : { status: s },
                      )
                    }
                  >
                    {statusLabel(s, manga)}
                  </Choice>
                ))}
              </div>
            </Section>

            <Section
              label={manga ? "reading progress" : "watch progress"}
              right={
                <div className="flex items-center gap-2">
                  {entry.rewatches > 0 && (
                    <span
                      className="font-mono text-[10px] text-fg-faint tnum"
                      title={`${manga ? "Reread" : "Rewatched"} ${entry.rewatches}×`}
                    >
                      ↻ {entry.rewatches}
                    </span>
                  )}
                  {(entry.status === "COMPLETED" ||
                    (entry.total != null &&
                      entry.total > 0 &&
                      entry.progress >= entry.total)) && (
                    <Btn
                      size="sm"
                      icon={<RotateCcw size={11} strokeWidth={1.75} />}
                      onClick={() =>
                        void patch({
                          rewatches: entry.rewatches + 1,
                          progress: 0,
                          status: "CURRENT",
                        })
                      }
                      title={
                        manga
                          ? "Start a reread (bumps rerun count, resets progress)"
                          : "Start a rewatch (bumps rerun count, resets progress)"
                      }
                    >
                      {manga ? "Reread" : "Rewatch"}
                    </Btn>
                  )}
                </div>
              }
            >
              <ProgressEdit
                progress={entry.progress}
                total={entry.total}
                onSet={(p) => patch({ progress: p })}
                unit={manga ? "chapters" : "episodes"}
                volumeText={
                  manga && entry.volumes && entry.chapters && entry.volumes > 0
                    ? `${Math.min(
                        entry.volumes,
                        Math.ceil((entry.progress * entry.volumes) / entry.chapters),
                      )} / ${entry.volumes} volumes`
                    : manga && entry.volumes && entry.volumes > 0
                      ? `${entry.volumes} volumes`
                      : null
                }
              />
            </Section>

            <Section label="score">
              <ScorePicker score={entry.score} onSet={(s) => patch({ score: s })} />
            </Section>

            <Section label="custom list">
              <select
                className="input"
                value={entry.customListId ?? ""}
                onChange={(e) =>
                  patch({ customListId: e.target.value ? Number(e.target.value) : -1 })
                }
              >
                <option value="">none</option>
                {customLists
                  .filter((c) => c.mediaType === entry.mediaType)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Section>

            <Section label="dates">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
                    <Calendar size={10} /> started
                  </div>
                  <input
                    type="date"
                    className="input"
                    value={entry.startDate ?? ""}
                    onChange={(e) => patch({ startDate: e.target.value || "" })}
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
                    <Calendar size={10} /> finished
                  </div>
                  <input
                    type="date"
                    className="input"
                    value={entry.finishDate ?? ""}
                    onChange={(e) => patch({ finishDate: e.target.value || "" })}
                  />
                </div>
              </div>
            </Section>

            <Section label="notes">
              <textarea
                key={entry.id}
                className="input"
                rows={3}
                defaultValue={entry.notes}
                placeholder="episode thoughts, where you left off, etc."
                onBlur={(e) => {
                  if (e.target.value !== entry.notes) patch({ notes: e.target.value });
                }}
              />
            </Section>


            {!manga && (
              <>
                <Section label="preferred fansub groups (nekoBT)">
                  <GroupPicker
                    includeIds={mediaGroups[0]}
                    excludeIds={mediaGroups[1]}
                    names={groupNames}
                    results={groupResults}
                    searching={searchingGroups}
                    onSearch={searchGroups}
                    onToggle={toggleGroup}
                    onRemove={removeGroup}
                  />
                </Section>

                <Section label="custom search names">
                  <ChipsInput
                    values={searchNames}
                    onChange={saveSearchNames}
                    placeholder="e.g. Chii Fuyo"
                    emptyHint="none — AniList titles are used"
                  />
                  <div className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-fg-faint">
                    used first for Nyaa & nekoBT queries (episode appended), and
                    for matching release titles; filters still apply
                  </div>
                </Section>

                <Section label="filter out releases">
                  <ChipsInput
                    values={releaseFilters}
                    onChange={saveReleaseFilters}
                    placeholder="e.g. 720p, x265, 10bit, HEVC"
                    tone="danger"
                    emptyHint="none — all qualities/codecs kept"
                  />
                  <div className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-fg-faint">
                    releases whose title contains a pattern are hidden (both trackers)
                  </div>
                </Section>

                <Section label="quality preference">
                  <ChipsInput
                    values={qualityPrefs}
                    onChange={saveQualityPrefs}
                    placeholder="e.g. 1080p, BluRay, dual audio"
                    tone="accent"
                    emptyHint="none — all releases shown"
                  />
                  <div className="mt-1.5 font-mono text-[9.5px] leading-relaxed text-fg-faint">
                    patterns are tried in order: the first one with matches keeps
                    only those releases; when nothing matches, everything is kept
                  </div>
                </Section>

                <Section
                  label="releases found"
                  right={
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        value={epInput}
                        onChange={(e) => setEpInput(e.target.value)}
                        className="input h-7 w-14 px-1 text-center text-[11px] tnum"
                        title="Episode to search for"
                      />
                      {releases.length > 0 && (
                        <Btn size="sm" variant="danger" onClick={clearReleases}>
                          Clear
                        </Btn>
                      )}
                      <Btn
                        size="sm"
                        variant="primary"
                        onClick={searchRelease}
                        disabled={searchingRelease}
                        icon={
                          searchingRelease ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Magnet size={11} />
                          )
                        }
                      >
                        Search
                      </Btn>
                    </div>
                  }
                >
                  {releases.length === 0 ? (
                    <div className="border border-dashed border-edge px-3 py-4 text-center font-mono text-[10.5px] leading-relaxed text-fg-faint">
                      no matching releases yet
                      <br />
                      auto-search runs ~15 min after airing time
                    </div>
                  ) : (
                    <ReleaseList
                      releases={releases.slice(0, 8)}
                      onQueue={(r) =>
                        void queueMagnet(
                          `${entry.title ?? "Entry"} — ep ${r.episode}`,
                          r.magnet!,
                          r.size,
                          r.episode,
                        )
                      }
                      onPlay={(r) => void openMpv(r.magnet!, r.episode)}
                    />
                  )}
                </Section>
              </>
            )}

            <div className="mt-6 flex justify-end border-t border-edge pt-4">
              <Btn variant="danger" size="sm" onClick={doRemove} icon={<Trash2 size={12} />}>
                Remove entry
              </Btn>
            </div>
          </div>
        )}

        {!loading && !isEntrySheet && sheet.anilistId != null && (
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <div className="mt-4 font-mono text-[11px] text-fg-muted">
              This title isn't on your list yet.
            </div>
            <Section label="status">
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <Choice key={s} active={addStatus === s} onClick={() => setAddStatus(s)}>
                    {statusLabel(s, manga)}
                  </Choice>
                ))}
              </div>
            </Section>
            <Section label="custom list (optional)">
              <select
                className="input"
                value={addCustom ?? ""}
                onChange={(e) =>
                  setAddCustom(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">none</option>
                {customLists
                  .filter((c) => c.mediaType === sheet.mediaType)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Section>
            <Btn
              variant="primary"
              className="mt-6 w-full"
              onClick={addFromSchedule}
              disabled={adding}
              icon={adding ? <Loader2 size={13} className="animate-spin" /> : undefined}
            >
              Add to list
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
