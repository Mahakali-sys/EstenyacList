import { Check } from "lucide-react";

export function SelectBadge({ selected }: { selected: boolean }) {
  return (
    <span
      className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[2px] border transition-colors ${
        selected
          ? "border-accent bg-accent text-white"
          : "border-edge-2 bg-surface/80 text-transparent group-hover:border-accent/60"
      }`}
    >
      <Check size={11} strokeWidth={3} />
    </span>
  );
}
