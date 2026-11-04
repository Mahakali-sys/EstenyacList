import { ListPlus, Magnet } from "lucide-react";
import type { ReleaseRow } from "../lib/types";
import { IconBtn } from "./ui";

export function ReleaseList({
  releases,
  onQueue,
  onPlay,
}: {
  releases: ReleaseRow[];
  onQueue: (r: ReleaseRow) => void;
  onPlay: (r: ReleaseRow) => void;
}) {
  return (
    <div className="border border-edge">
      {releases.map((r) => (
        <div
          key={r.id}
          className="group flex items-center gap-2 border-b border-edge px-2 py-1.5 last:border-b-0 hover:bg-surface-2/70"
        >
          <span className="w-10 shrink-0 font-mono text-[10px] text-fg-faint tnum">
            ep {r.episode}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-medium" title={r.title}>
              {r.title}
            </div>
            <div className="font-mono text-[9.5px] text-fg-faint tnum">
              {r.size ?? "?"} · <span className={r.seeders > 0 ? "text-moss" : ""}>{r.seeders}</span> s /{" "}
              {r.leechers} l
            </div>
          </div>
          {r.magnet && (
            <>
              <IconBtn
                title="Add to watch queue"
                onClick={() => onQueue(r)}
                className="!h-6 !w-6 border border-edge bg-surface-2"
              >
                <ListPlus size={12} strokeWidth={1.75} />
              </IconBtn>
              <IconBtn
                title="Open in mpv (webtorrent-mpv-hook)"
                onClick={() => onPlay(r)}
                className="!h-6 !w-6 bg-accent text-white hover:!bg-accent hover:!text-white"
              >
                <Magnet size={12} strokeWidth={1.75} />
              </IconBtn>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
