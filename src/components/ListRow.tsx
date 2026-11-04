import type { EntryView } from "../lib/types";
import { useStore } from "../store";
import { Cover } from "./Cover";
import { EntryMenu } from "./EntryMenu";
import { SelectBadge } from "./SelectBadge";
import { Bar, ScoreStamp } from "./ui";

// Compact table-style row: index gutter, miniature cover (36x54), title,
// hairline progress. Scans like a printed list, not a pile of cards.
export function ListRow({
  entry,
  index,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onHover,
}: {
  entry: EntryView;
  index: number;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (shift: boolean) => void;
  onHover?: (id: number | null) => void;
}) {
  const openEntrySheet = useStore((s) => s.openEntrySheet);
  const flash = useStore((s) => s.flashEntry);
  const flashing = flash?.id === entry.id;

  const manga = entry.mediaType === "MANGA";
  const left =
    entry.total != null ? Math.max(0, entry.total - entry.progress) : null;
  const pct = entry.total
    ? Math.min(100, (entry.progress / Math.max(1, entry.total)) * 100)
    : entry.progress > 0
      ? 100
      : 0;
  const done =
    entry.total != null && entry.total > 0 && entry.progress >= entry.total;

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-3 border-b border-edge px-3 py-[7px] transition-colors ${
        selected ? "bg-accent/10" : "hover:bg-surface-2/70"
      } ${flashing ? (flash.dir === 1 ? "flash-up" : "flash-down") : ""}`}
      onClick={(e) => {
        if (selectMode) onToggleSelect?.(e.shiftKey);
        else openEntrySheet(entry.id);
      }}
      onMouseEnter={() => onHover?.(entry.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {selectMode && <SelectBadge selected={selected} />}
      <span className="w-6 shrink-0 select-none text-right font-mono text-[10px] text-fg-faint tnum">
        {index}
      </span>
      <Cover
        anilistId={entry.anilistId}
        coverUrl={entry.coverUrl}
        title={entry.title}
        className="h-[54px] w-9 shrink-0 overflow-hidden rounded-[2px] border border-edge/70 bg-surface-2"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div
            className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight"
            title={entry.titleEnglish ?? entry.title ?? ""}
          >
            {entry.title}
          </div>
          <ScoreStamp score={entry.score} />
        </div>
        <div className="mt-[3px] flex items-center gap-1.5 truncate font-mono text-[10px] text-fg-faint">
          {(entry.format || entry.seasonYear) && (
            <>
              <span>
                {entry.format ?? ""}
                {entry.format && entry.seasonYear ? " · " : ""}
                {entry.seasonYear ?? ""}
              </span>
              <span className="text-edge-2">/</span>
            </>
          )}
          <span className="tnum">
            {entry.total != null && entry.total > 0 ? (
              <>
                {entry.progress}/{entry.total}
                {left != null && left > 0 && (
                  <span className="text-fg-faint/70"> · {left} left</span>
                )}
                {done && <span className="font-semibold text-moss"> ✓</span>}
              </>
            ) : (
              <>
                {entry.progress} {manga ? "ch." : "ep."}
              </>
            )}
            {entry.rewatches > 0 && (
              <span
                className="text-fg-faint/80"
                title={`${manga ? "Reread" : "Rewatched"} ${entry.rewatches}×`}
              >
                {" "}↻{entry.rewatches}
              </span>
            )}
          </span>
        </div>
        <Bar pct={pct} tone={done ? "moss" : "accent"} className="mt-[6px]" />
      </div>
      {!selectMode && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <EntryMenu entry={entry} />
        </div>
      )}
      {selectMode && <div className="w-1" />}
    </div>
  );
}
