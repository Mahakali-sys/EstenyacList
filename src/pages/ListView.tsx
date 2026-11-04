import {
  ArrowDownAZ,
  ArrowUpZA,
  BookOpen,
  Clock,
  Filter,
  LayoutGrid,
  List as ListIcon,
  ListChecks,
  Pencil,
  Plus,
  Search,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { statusLabel } from "../lib/types";
import type { EntryView, ViewMode } from "../lib/types";
import { useStore } from "../store";
import { AnimeCard } from "../components/AnimeCard";
import { ListRow } from "../components/ListRow";
import { BulkEditDialog } from "../components/BulkEditDialog";
import { Btn, EmptyState, IconBtn, Kbd, Seg } from "../components/ui";

const EMPTY_LIST: EntryView[] = [];

type SortOrder = "added" | "az" | "za";

const MIN_SCORES = [8, 7, 6, 5, 4] as const;

export function ListView({
  mediaType,
  status,
  customListId,
}: {
  mediaType: "ANIME" | "MANGA";
  status?: string;
  customListId?: number;
}) {
  const entriesKey = `${mediaType}:${status ?? ""}:${customListId ?? ""}`;
  const entries = useStore((s) => s.entries[entriesKey] ?? EMPTY_LIST);
  const loadList = useStore((s) => s.loadList);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const customLists = useStore((s) => s.customLists);
  const loadCustomLists = useStore((s) => s.loadCustomLists);
  const viewMode = useStore((s) => s.settings.listView ?? "list");
  const setSetting = useStore((s) => s.setSetting);
  const setHoverEntry = useStore((s) => s.setHoverEntry);
  const toast = useStore((s) => s.toast);
  const [sortOrder, setSortOrder] = useState<SortOrder>("added");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("");
  const [minScore, setMinScore] = useState(0);
  const anchorRef = useRef<number | null>(null);

  const manga = mediaType === "MANGA";

  useEffect(() => {
    loadList(mediaType, status, customListId);
    if (customListId != null) loadCustomLists();
  }, [mediaType, status, customListId, loadList, loadCustomLists]);

  useEffect(() => {
    return () => setHoverEntry(null);
  }, [setHoverEntry]);

  const title = useMemo(() => {
    if (customListId != null) {
      return customLists.find((c) => c.id === customListId)?.name ?? "Custom list";
    }
    return statusLabel(status ?? "", manga);
  }, [customListId, customLists, status, manga]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      for (const g of (e.genres ?? "").split(",")) {
        const t = g.trim();
        if (t) set.add(t);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filtering = query.trim() !== "" || genre !== "" || minScore > 0;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (q) {
        const hay = `${e.title ?? ""} ${e.titleEnglish ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (genre) {
        const has = (e.genres ?? "")
          .split(",")
          .some((g) => g.trim() === genre);
        if (!has) return false;
      }
      if (minScore > 0 && e.score < minScore) return false;
      return true;
    });
  }, [entries, query, genre, minScore]);

  const sorted = useMemo(() => {
    if (sortOrder === "added") return visible;
    const dir = sortOrder === "az" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const ta = (a.title ?? "").toLowerCase();
      const tb = (b.title ?? "").toLowerCase();
      return ta.localeCompare(tb) * dir;
    });
  }, [visible, sortOrder]);

  const indexById = useMemo(() => {
    const m = new Map<number, number>();
    sorted.forEach((e, i) => m.set(e.id, i));
    return m;
  }, [sorted]);

  // keyboard +1 / -1 on the hovered entry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selectMode) return;
      if (e.key !== "+" && e.key !== "=" && e.key !== "-" && e.key !== "_")
        return;
      const ae = document.activeElement;
      const tag = ae?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStore.getState();
      if (st.searchOpen) return;
      if (st.sheet.entryId != null || st.sheet.anilistId != null) return;
      const id = st.hoverEntryId;
      if (id == null) return;
      const entry = useStore
        .getState()
        .entries[entriesKey]?.find((x) => x.id === id);
      if (!entry) return;
      e.preventDefault();
      const dir: 1 | -1 = e.key === "+" || e.key === "=" ? 1 : -1;
      const next = Math.max(
        0,
        Math.min(
          entry.total && entry.total > 0 ? entry.total : 99999,
          entry.progress + dir,
        ),
      );
      st.flashProgress(id, dir);
      if (next !== entry.progress) {
        void st.updateEntry({ id, progress: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode, entriesKey]);

  const toggleSelect = (id: number, shift: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const i = indexById.get(id) ?? -1;
      if (shift && anchorRef.current != null) {
        const a = indexById.get(anchorRef.current) ?? i;
        const [lo, hi] = a < i ? [a, i] : [i, a];
        const willAdd = !prev.has(id);
        for (let k = lo; k <= hi; k++) {
          const eid = sorted[k]?.id;
          if (eid == null) continue;
          if (willAdd) next.add(eid);
          else next.delete(eid);
        }
      } else if (next.has(id)) {
        next.delete(id);
        anchorRef.current = null;
      } else {
        next.add(id);
        anchorRef.current = id;
      }
      return next;
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkEditOpen(false);
    anchorRef.current = null;
  };

  const bulkRemove = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const st = useStore.getState();
    const ok = await ids.reduce(async (acc, id) => {
      const n = await acc;
      try {
        await st.removeEntry(id);
        st.removeEntryLocal(id);
        return n + 1;
      } catch {
        return n;
      }
    }, Promise.resolve(0));
    toast(`Removed ${ok} ${ok === 1 ? "entry" : "entries"}`, "success");
    exitSelect();
  };

  const hoverProps = {
    onHover: selectMode ? undefined : setHoverEntry,
    selectMode,
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <div className="flex items-baseline gap-2">
          {manga ? (
            <BookOpen size={14} className="self-center text-accent" strokeWidth={1.75} />
          ) : (
            <Tv size={14} className="self-center text-accent" strokeWidth={1.75} />
          )}
          <h1 className="display text-[17px] font-semibold">
            {title.toLowerCase()}
          </h1>
          <span className="font-mono text-[10px] text-fg-faint tnum">
            {filtering
              ? `${visible.length} of ${entries.length}`
              : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
          </span>
          {!selectMode && entries.length > 0 && (
            <span className="hidden items-center gap-1 font-mono text-[9.5px] text-fg-faint xl:flex">
              · hover + <Kbd>+</Kbd>
              <Kbd>−</Kbd> to bump
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Btn
            size="sm"
            variant={selectMode ? "primary" : "outline"}
            disabled={entries.length === 0}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            title="Bulk selection mode"
            icon={<ListChecks size={12} strokeWidth={1.75} />}
          >
            {selectMode ? "Cancel" : "Select"}
          </Btn>
          {!selectMode && (
            <>
              <Btn
                size="sm"
                variant={filtering || filtersOpen ? "primary" : "outline"}
                disabled={entries.length === 0}
                onClick={() => setFiltersOpen((v) => !v)}
                icon={<Filter size={12} strokeWidth={1.75} />}
              >
                Filter
              </Btn>
              <Seg<ViewMode>
                value={viewMode}
                onChange={(v) => setSetting("listView", v)}
                options={[
                  {
                    id: "list",
                    label: <ListIcon size={12} strokeWidth={1.75} />,
                    title: "List view",
                  },
                  {
                    id: "grid",
                    label: <LayoutGrid size={12} strokeWidth={1.75} />,
                    title: "Grid view",
                  },
                ]}
              />
              <Seg<SortOrder>
                value={sortOrder}
                onChange={setSortOrder}
                options={[
                  {
                    id: "added",
                    label: <Clock size={12} strokeWidth={1.75} />,
                    title: "Sort by date added",
                  },
                  {
                    id: "az",
                    label: <ArrowDownAZ size={12} strokeWidth={1.75} />,
                    title: "Sort A → Z",
                  },
                  {
                    id: "za",
                    label: <ArrowUpZA size={12} strokeWidth={1.75} />,
                    title: "Sort Z → A",
                  },
                ]}
              />
            </>
          )}
          <Btn
            size="sm"
            variant="primary"
            onClick={() => setSearchOpen(true)}
            icon={<Plus size={12} strokeWidth={2} />}
          >
            Add {manga ? "manga" : "anime"}
          </Btn>
        </div>
      </div>

      {filtersOpen && !selectMode && entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-edge-2 px-4 pb-2">
          <div className="relative">
            <Search
              size={11}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title…"
              className="input h-7 w-52 pl-6 text-[11px]"
            />
          </div>
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="input h-7 w-36 text-[11px]"
          >
            <option value="">Any genre</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="input h-7 w-28 text-[11px]"
          >
            <option value={0}>Any score</option>
            {MIN_SCORES.map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
          {filtering && (
            <IconBtn
              title="Clear filters"
              className="h-7 w-7"
              onClick={() => {
                setQuery("");
                setGenre("");
                setMinScore(0);
              }}
            >
              <X size={12} />
            </IconBtn>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {entries.length === 0 ? (
          <EmptyState
            icon={manga ? <BookOpen size={26} strokeWidth={1.5} /> : <Tv size={26} strokeWidth={1.5} />}
            title="Nothing here yet"
            sub={`Search AniList and start tracking ${manga ? "manga" : "anime"}.`}
            action={
              <Btn
                variant="primary"
                size="sm"
                onClick={() => setSearchOpen(true)}
                icon={<Plus size={12} />}
              >
                Add {manga ? "manga" : "anime"}
              </Btn>
            }
          />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<Search size={26} strokeWidth={1.5} />}
            title="No matches"
            sub="No entries match the current filters."
            action={
              <Btn
                size="sm"
                onClick={() => {
                  setQuery("");
                  setGenre("");
                  setMinScore(0);
                }}
              >
                Clear filters
              </Btn>
            }
          />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {sorted.map((e) => (
              <AnimeCard
                key={e.id}
                entry={e}
                selected={selectedIds.has(e.id)}
                onToggleSelect={(shift) => toggleSelect(e.id, shift)}
                {...hoverProps}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl border-t border-edge">
            {sorted.map((e) => (
              <ListRow
                key={e.id}
                entry={e}
                index={indexById.get(e.id)! + 1}
                selected={selectedIds.has(e.id)}
                onToggleSelect={(shift) => toggleSelect(e.id, shift)}
                {...hoverProps}
              />
            ))}
          </div>
        )}
      </div>

      {selectMode && (
        <div className="anim-toast fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-2 border border-edge bg-surface px-3 py-2 shadow-[var(--shadow-pop)]">
            <span className="min-w-16 font-mono text-[11px] font-semibold tnum">
              {selectedIds.size} selected
            </span>
            <Btn
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={() => setBulkEditOpen(true)}
              icon={<Pencil size={12} strokeWidth={1.75} />}
            >
              Edit…
            </Btn>
            <Btn
              size="sm"
              variant="danger"
              disabled={selectedIds.size === 0}
              onClick={() => void bulkRemove()}
              icon={<Trash2 size={12} strokeWidth={1.75} />}
            >
              Delete
            </Btn>
            <IconBtn title="Exit selection" onClick={exitSelect}>
              <X size={14} />
            </IconBtn>
          </div>
        </div>
      )}

      {bulkEditOpen && selectedIds.size > 0 && (
        <BulkEditDialog
          ids={[...selectedIds]}
          mediaType={mediaType}
          customLists={customLists}
          onClose={() => setBulkEditOpen(false)}
          onApplied={() => exitSelect()}
        />
      )}
    </div>
  );
}
