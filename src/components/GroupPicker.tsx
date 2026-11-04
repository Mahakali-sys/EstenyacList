import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { NekoGroup } from "../lib/types";
import { Btn, Chip, Label } from "./ui";

export function GroupPicker({
  includeIds,
  excludeIds,
  names,
  results,
  searching,
  onSearch,
  onToggle,
  onRemove,
}: {
  includeIds: string[];
  excludeIds: string[];
  names: Record<string, string>;
  results: NekoGroup[] | null;
  searching: boolean;
  onSearch: (query: string) => void;
  onToggle: (list: "include" | "exclude", g: NekoGroup) => void;
  onRemove: (list: "include" | "exclude", id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const submit = () => {
    const q = query.trim();
    if (q) onSearch(q);
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>only from</Label>
          <div className="mt-1.5 flex min-h-5 flex-wrap gap-1.5">
            {includeIds.length === 0 && (
              <span className="font-mono text-[10px] text-fg-faint">any group</span>
            )}
            {includeIds.map((id) => (
              <Chip
                key={id}
                tone="accent"
                onRemove={() => onRemove("include", id)}
                title="Allow only this group"
              >
                {names[id] ?? id}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>never from</Label>
          <div className="mt-1.5 flex min-h-5 flex-wrap gap-1.5">
            {excludeIds.length === 0 && (
              <span className="font-mono text-[10px] text-fg-faint">no blocks</span>
            )}
            {excludeIds.map((id) => (
              <Chip
                key={id}
                tone="danger"
                onRemove={() => onRemove("exclude", id)}
                title="Block this group"
              >
                {names[id] ?? id}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex gap-1.5">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Search fansub groups…"
        />
        <Btn
          onClick={submit}
          disabled={searching}
          icon={searching ? <Loader2 size={11} className="animate-spin" /> : undefined}
        >
          Search
        </Btn>
      </div>

      {results && (
        <div className="mt-2 max-h-44 overflow-y-auto border border-edge bg-surface">
          {results.length === 0 && (
            <div className="px-2 py-1.5 font-mono text-[10.5px] text-fg-faint">
              no groups found
            </div>
          )}
          {results.map((g) => {
            const allowed = includeIds.includes(g.id);
            const blocked = excludeIds.includes(g.id);
            return (
              <div
                key={g.id}
                className="flex items-center gap-2 border-b border-edge px-2 py-1.5 last:border-b-0 hover:bg-surface-2/70"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold">
                    {g.displayName}
                  </div>
                  <div className="font-mono text-[9.5px] text-fg-faint">
                    {g.torrentCount ?? "?"} torrents
                    {g.tagline ? ` · ${g.tagline}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => onToggle("include", g)}
                  className={`chip ${allowed ? "chip-accent" : ""} cursor-pointer`}
                  title={allowed ? "Stop allowing" : "Allow only releases from this group"}
                >
                  {allowed ? "allowed ✓" : "allow"}
                </button>
                <button
                  onClick={() => onToggle("exclude", g)}
                  className={`chip ${blocked ? "chip-danger" : ""} cursor-pointer`}
                  title={blocked ? "Unblock" : "Never use this group"}
                >
                  {blocked ? "blocked ✕" : "block"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
