import { SCORE_TIERS, SCORE_TIER_COLOR, scoreTier } from "../lib/types";
import { Face } from "./ui";

export function ScorePicker({
  score,
  onSet,
}: {
  score: number;
  onSet: (score: number) => void;
}) {
  const active = scoreTier(score);
  const activeMeta = SCORE_TIERS.find((t) => t.tier === active);

  return (
    <div className="flex items-center gap-2">
      {SCORE_TIERS.map((t) => {
        const on = active === t.tier;
        const color = SCORE_TIER_COLOR[t.tier];
        return (
          <button
            key={t.tier}
            className={`stamp h-12 w-14 flex-col gap-0.5 ${
              on ? "" : "border-edge opacity-60 hover:opacity-100"
            }`}
            style={
              on
                ? {
                    borderColor: color,
                    color,
                    background: `color-mix(in srgb, ${color} 8%, transparent)`,
                  }
                : undefined
            }
            title={`${t.label} (${t.range})${on ? " — click to clear" : ""}`}
            onClick={() => onSet(on ? 0 : t.value)}
          >
            <Face face={t.face} size={17} />
            <span className="font-mono text-[7.5px] uppercase tracking-[0.08em]">
              {t.label}
            </span>
          </button>
        );
      })}
      <div className="ml-1 font-mono text-[10px] leading-relaxed text-fg-faint">
        {activeMeta ? (
          <>
            rated <b className="text-fg-muted">{activeMeta.label}</b>
          </>
        ) : (
          "unrated"
        )}
        <br />
        click again to clear
      </div>
    </div>
  );
}
