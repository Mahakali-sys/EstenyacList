import { Minus, Plus } from "lucide-react";
import { Bar, IconBtn } from "./ui";

export function ProgressEdit({
  progress,
  total,
  onSet,
  unit,
  volumeText = null,
}: {
  progress: number;
  total: number | null;
  onSet: (p: number) => void;
  unit: string;
  volumeText?: string | null;
}) {
  const left = total != null ? Math.max(0, total - progress) : null;
  const pct = total ? Math.min(100, (progress / Math.max(1, total)) * 100) : 0;
  const done = total != null && total > 0 && progress >= total;

  const dec = () => onSet(Math.max(0, progress - 1));
  const inc = () =>
    onSet(total != null ? Math.min(Math.max(0, total), progress + 1) : progress + 1);

  return (
    <div className="flex items-center gap-3">
      <IconBtn
        title={`Decrease ${unit}`}
        onClick={dec}
        disabled={progress <= 0}
        className="!h-8 !w-8 border border-edge bg-surface-2"
      >
        <Minus size={15} strokeWidth={1.75} />
      </IconBtn>
      <div className="min-w-[104px]">
        <div className="flex items-baseline justify-center gap-1">
          <input
            type="number"
            className="display w-14 border-none bg-transparent text-center text-[26px] font-semibold leading-none outline-none tnum"
            value={progress}
            min={0}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v))
                onSet(
                  Math.max(
                    0,
                    Math.min(total ?? Number.MAX_SAFE_INTEGER, Math.floor(v)),
                  ),
                );
            }}
          />
          {total != null && (
            <span className="font-mono text-[12px] text-fg-faint tnum">/ {total}</span>
          )}
        </div>
        <Bar pct={pct} tone={done ? "moss" : "accent"} className="mt-1.5" />
      </div>
      <IconBtn
        title={`Increase ${unit}`}
        onClick={inc}
        disabled={total != null && progress >= total}
        className="!h-8 !w-8 border border-edge bg-surface-2"
      >
        <Plus size={15} strokeWidth={1.75} />
      </IconBtn>
      <div className="ml-1 font-mono text-[10.5px] leading-relaxed text-fg-faint">
        {left != null ? (
          left === 0 ? (
            <span className="font-semibold text-moss">done</span>
          ) : (
            <span>
              <b className="text-fg-muted tnum">{left}</b> {unit} left
            </span>
          )
        ) : (
          <span>total unknown</span>
        )}
        {volumeText && <div className="mt-0.5 whitespace-nowrap">{volumeText}</div>}
      </div>
    </div>
  );
}
