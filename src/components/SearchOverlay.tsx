import { BookOpen, Database, Globe, Loader2, Plus, Search, Tv, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { EntryView, MediaSummary } from "../lib/types";
import { STATUSES, statusLabel } from "../lib/types";
import { useStore } from "../store";
import { Cover } from "./Cover";
import { Dropdown } from "./Dropdown";
import { Bar, IconBtn, Kbd, Seg, useEscape } from "./ui";

type SearchMode = "anilist" | "local";

export function SearchOverlay() {
  const open = useStore((s) => s.searchOpen);
  const setOpen = useStore((s) => s.setSearchOpen);
  const toast = useStore((s) => s.toast);
  const refreshEntries = useStore((s) => s.refreshEntries);
  const customLists = useStore((s) => s.customLists);
  const loadCustomLists = useStore((s) => s.loadCustomLists);
  const openEntrySheet = useStore((s) => s.openEntrySheet);

  const [q, setQ] = useState("");
  const [type, setType] = useState<"ANIME" | "MANGA">("ANIME");
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [localResults, setLocalResults] = useState<EntryView[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [customChoice, setCustomChoice] = useState<Record<number, number | null>>({});
  const [mode, setMode] = useState<SearchMode>("anilist");
  const inputRef = useRef<HTMLInputElement>(null);

  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      loadCustomLists();
    }
  }, [open, loadCustomLists]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLocalResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        if (mode === "anilist") {
          const r = await api.searchAnilist(trimmed, type);
          setResults(r);
        } else {
          const r = await api.searchLocal(trimmed, type);
          setLocalResults(r);
        }
      } catch (e) {
        toast(String(e), "error");
      } finally {
        setSearching(false);
      }
    }, mode === "anilist" ? 450 : 200);
    return () => clearTimeout(t);
  }, [q, type, open, toast, mode]);

  // Clear results when switching modes
  useEffect(() => {
    setResults([]);
    setLocalResults([]);
  }, [mode]);

  if (!open) return null;

  const add = async (m: MediaSummary, status: string) => {
    setAdding(m.id);
    try {
      const e = await api.addEntry(m.id, type, status);
      if (e?.id) {
        const cid = customChoice[m.id];
        if (cid != null) {
          await api.updateEntry({ id: e.id, customListId: cid });
        }
      }
      toast(`${m.titleRomaji} → ${statusLabel(status, type === "MANGA")}`, "success");
      refreshEntries(type);
    } catch (err) {
      toast(String(err), "error");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-6 pt-[9vh]">
      <div
        className="absolute inset-0 bg-black/55"
        onClick={() => setOpen(false)}
      />
      <div className="anim-in relative flex max-h-[78vh] w-full max-w-[680px] flex-col overflow-hidden border border-edge bg-surface shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search size={16} className="shrink-0 text-fg-faint" />
          <input
            ref={inputRef}
            className="h-12 flex-1 border-none bg-transparent text-[15px] outline-none placeholder:text-fg-faint"
            placeholder={
              mode === "anilist"
                ? `search AniList for ${type === "ANIME" ? "anime" : "manga"}…`
                : `search your ${type === "ANIME" ? "anime" : "manga"} list…`
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Seg
            accent
            value={mode}
            onChange={(m) => setMode(m)}
            options={[
              {
                id: "anilist",
                label: (
                  <span className="flex items-center gap-1.5">
                    <Globe size={11} strokeWidth={1.75} /> AniList
                  </span>
                ),
                title: "Search the AniList API",
              },
              {
                id: "local",
                label: (
                  <span className="flex items-center gap-1.5">
                    <Database size={11} strokeWidth={1.75} /> My list
                  </span>
                ),
                title: "Search your local list",
              },
            ]}
          />
          <Seg
            value={type}
            onChange={(t) => setType(t)}
            options={[
              {
                id: "ANIME",
                label: (
                  <span className="flex items-center gap-1.5">
                    <Tv size={11} strokeWidth={1.75} /> Anime
                  </span>
                ),
              },
              {
                id: "MANGA",
                label: (
                  <span className="flex items-center gap-1.5">
                    <BookOpen size={11} strokeWidth={1.75} /> Manga
                  </span>
                ),
              },
            ]}
          />
          <IconBtn title="Close (Esc)" onClick={() => setOpen(false)}>
            <X size={15} />
          </IconBtn>
        </div>

        <div className="flex-1 overflow-y-auto">
          {searching && (
            <div className="flex items-center justify-center gap-2 py-10 font-mono text-[11px] text-fg-faint">
              <Loader2 size={15} className="animate-spin text-accent" />
              {mode === "anilist" ? "searching AniList (rate limited)…" : "searching your list…"}
            </div>
          )}

          {mode === "anilist" && (
            <>
              {!searching && results.length === 0 && q.trim().length >= 2 && (
                <div className="py-10 text-center font-mono text-[11px] text-fg-faint">
                  no results found
                </div>
              )}
              {results.map((m) => {
                const inList = !!m.inList;
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 border-b border-edge px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface-2/60"
                  >
                    <Cover
                      anilistId={m.id}
                      coverUrl={m.coverUrl}
                      title={m.titleRomaji}
                      className="h-[72px] w-12 shrink-0 overflow-hidden rounded-[2px] border border-edge bg-surface-2"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">
                        {m.titleRomaji}
                      </div>
                      {m.titleEnglish && m.titleEnglish !== m.titleRomaji && (
                        <div className="truncate text-[11px] text-fg-muted">
                          {m.titleEnglish}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-fg-faint">
                        <span>{m.format ?? "—"}</span>
                        {m.episodes != null && <span>· {m.episodes} ep</span>}
                        {m.chapters != null && <span>· {m.chapters} ch</span>}
                        {m.averageScore != null && (
                          <span style={{ color: "var(--ochre)" }}>
                            · {m.averageScore}%
                          </span>
                        )}
                        {m.genres && <span className="truncate">· {m.genres.slice(0, 3).join(", ")}</span>}
                      </div>
                    </div>
                    {inList ? (
                      <span className="chip chip-accent shrink-0">in list</span>
                    ) : (
                      <Dropdown
                        trigger={
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={adding === m.id}
                          >
                            {adding === m.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Plus size={12} />
                            )}
                            Add
                          </button>
                        }
                        align="right"
                      >
                        {(close) => (
                          <div>
                            <div className="max-h-44 overflow-y-auto">
                              {STATUSES.map((s) => (
                                <button
                                  key={s}
                                  className="menu-item"
                                  onClick={() => {
                                    close();
                                    add(m, s);
                                  }}
                                >
                                  {statusLabel(s, type === "MANGA")}
                                </button>
                              ))}
                            </div>
                            <div className="menu-rule" />
                            <select
                              className="input mx-2 mb-1 !h-6 !w-[calc(100%-16px)] text-[11px]"
                              value={customChoice[m.id] ?? ""}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setCustomChoice({
                                  ...customChoice,
                                  [m.id]: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                })
                              }
                            >
                              <option value="">no custom list</option>
                              {customLists
                                .filter((c) => c.mediaType === type)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                      </Dropdown>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {mode === "local" && (
            <>
              {!searching && localResults.length === 0 && q.trim().length >= 2 && (
                <div className="py-10 text-center font-mono text-[11px] text-fg-faint">
                  no entries found in your list
                </div>
              )}
              {localResults.map((entry) => {
                const manga = entry.mediaType === "MANGA";
                const pct = entry.total
                  ? Math.min(100, (entry.progress / Math.max(1, entry.total)) * 100)
                  : entry.progress > 0
                    ? 100
                    : 0;
                return (
                  <div
                    key={entry.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-edge px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface-2/60"
                    onClick={() => {
                      setOpen(false);
                      openEntrySheet(entry.id);
                    }}
                  >
                    <Cover
                      anilistId={entry.anilistId}
                      coverUrl={entry.coverUrl}
                      title={entry.title}
                      className="h-[72px] w-12 shrink-0 overflow-hidden rounded-[2px] border border-edge bg-surface-2"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">
                        {entry.title}
                      </div>
                      {entry.titleEnglish && entry.titleEnglish !== entry.title && (
                        <div className="truncate text-[11px] text-fg-muted">
                          {entry.titleEnglish}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-fg-faint">
                        <span>{entry.format ?? "—"}</span>
                        <span className="tnum">
                          · {entry.progress}
                          {entry.total ? `/${entry.total}` : ""} {manga ? "ch" : "ep"}
                        </span>
                        {entry.averageScore != null && (
                          <span style={{ color: "var(--ochre)" }}>
                            · {entry.averageScore}%
                          </span>
                        )}
                      </div>
                      <Bar pct={pct} className="mt-1.5 max-w-32" />
                    </div>
                    <span className="chip chip-accent shrink-0">
                      {statusLabel(entry.status, manga)}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-edge px-4 py-1.5 font-mono text-[9.5px] text-fg-faint">
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd> toggle
          </span>
          <span className="ml-auto">anilist is rate limited — results may take a moment</span>
        </div>
      </div>
    </div>
  );
}
