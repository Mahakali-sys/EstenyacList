import { useState } from "react";
import { Chip } from "./ui";

export function ChipsInput({
  values,
  onChange,
  placeholder,
  tone = "accent",
  emptyHint,
  addTitle = "Add",
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  tone?: "accent" | "danger";
  emptyHint?: string;
  addTitle?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };

  return (
    <div>
      <div className="flex min-h-5 flex-wrap gap-1.5">
        {values.length === 0 && emptyHint && (
          <span className="font-mono text-[10px] text-fg-faint">{emptyHint}</span>
        )}
        {values.map((v) => (
          <Chip
            key={v}
            tone={tone}
            onRemove={() => onChange(values.filter((x) => x !== v))}
          >
            {v}
          </Chip>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        <input
          className="input h-6 text-[11px]"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          onClick={add}
          className={`btn btn-sm px-2 ${tone === "danger" ? "btn-danger" : "btn-outline"}`}
          title={addTitle}
        >
          +
        </button>
      </div>
    </div>
  );
}
