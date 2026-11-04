import type { EntryView } from "../lib/types";
import { useStore } from "../store";
import { Cover } from "./Cover";
import { EntryMenu } from "./EntryMenu";
import { SelectBadge } from "./SelectBadge";
import { Bar, ScoreStamp } from "./ui";

// Grid "plate": poster with a hairline frame, quiet metadata below.
export function AnimeCard({
  entry,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onHover,
}: {
  entry: EntryView;
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
  const trending = entry.averageScore != null && entry.averageScore >= 75;

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-[3px] border bg-surface-2/40 transition-colors ${
        selected
          ? "border-accent"
          : "border-edge hover:border-edge-2"
      } ${flashing ? (flash.dir === 1 ? "flash-up" : "flash-down") : ""}`}
      onClick={(e) => {
        if (selectMode) onToggleSelect?.(e.shiftKey);
        else openEntrySheet(entry.id);
      }}
      onMouseEnter={() => onHover?.(entry.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-surface-3">
        <Cover
          anilistId={entry.anilistId}
          coverUrl={entry.coverUrl}
          title={entry.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)]" />
        {selectMode ? (
          <div className="absolute left-1.5 top-1.5">
            <SelectBadge selected={selected} />
          </div>
        ) : (
          <>
            {trending && (
              <span
                className="absolute left-1.5 top-1.5 bg-black/60 px-1 font-mono text-[9.5px] font-semibold text-amber-200"
                title="AniList community score"
              >
                {entry.averageScore}%
              </span>
            )}
            <span
              className="absolute right-1.5 top-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ScoreStamp score={entry.score} className="border-edge-2/60 bg-black/50" />
            </span>
          </>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-3 font-mono text-[9.5px] text-white/85">
          {entry.format ?? ""}
          {entry.format && entry.seasonYear ? " · " : ""}
          {entry.seasonYear ?? ""}
        </div>
      </div>

      <div className="p-2">
        <div
          className="line-clamp-2 min-h-[2.4em] text-[12.5px] font-semibold leading-tight"
          title={entry.titleEnglish ?? entry.title ?? ""}
        >
          {entry.title}
        </div>
        <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-fg-faint">
          <span className="tnum">
            {entry.total ? (
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
          {!selectMode && (
            <span onClick={(e) => e.stopPropagation()}>
              <EntryMenu entry={entry} />
            </span>
          )}
        </div>
        <Bar pct={pct} tone={done ? "moss" : "accent"} className="mt-1.5" />
      </div>
    </div>
  );
}
