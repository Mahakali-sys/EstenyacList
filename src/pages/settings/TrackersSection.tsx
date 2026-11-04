import { CircleCheck, Download, Loader2, Magnet, Radar } from "lucide-react";
import { useState } from "react";
import { GroupPicker } from "../../components/GroupPicker";
import { ChipsInput } from "../../components/ChipsInput";
import { Btn, Label, Panel, Seg, Toggle } from "../../components/ui";
import { api } from "../../lib/api";
import type { NekoFilters, NekoGroup, NekoTorrent, NyaaResult } from "../../lib/types";
import { useStore } from "../../store";

const LBL = "mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint";

export function TrackersSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const [nyaTest, setNyaTest] = useState("");
  const [nyaResults, setNyaResults] = useState<NyaaResult[] | null>(null);
  const [testingNyaa, setTestingNyaa] = useState(false);
  const [nekoTest, setNekoTest] = useState("");
  const [nekoResults, setNekoResults] = useState<NekoTorrent[] | null>(null);
  const [testingNeko, setTestingNeko] = useState(false);
  const [groupResults, setGroupResults] = useState<NekoGroup[] | null>(null);
  const [searchingGroups, setSearchingGroups] = useState(false);

  const tracker = settings.tracker ?? "auto";

  const filters = settings.nyaaFilters ?? {
    enabled: true,
    include: ["1080"],
    exclude: ["720", "480"],
  };
  const saveFilters = async (next: typeof filters) => {
    await setSetting("nyaaFilters", next);
  };

  const nekoFilters: NekoFilters = settings.nekoFilters ?? {
    enabled: true,
    levels: [],
    audioLang: [],
    fsubLang: [],
    subLang: [],
    hardsub: null,
    batch: null,
    otl: null,
    mtl: null,
    includeGroups: [],
    excludeGroups: [],
  };
  const saveNekoFilters = async (next: NekoFilters) => {
    await setSetting("nekoFilters", next);
  };

  const testNyaa = async () => {
    if (!nyaTest.trim()) return;
    setTestingNyaa(true);
    try {
      setNyaResults(await api.nyaaTest(nyaTest));
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setTestingNyaa(false);
    }
  };

  const testNeko = async () => {
    if (!nekoTest.trim()) return;
    setTestingNeko(true);
    try {
      setNekoResults(await api.nekoTest(nekoTest));
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setTestingNeko(false);
    }
  };

  const searchGroups = async (query: string) => {
    setSearchingGroups(true);
    try {
      setGroupResults(await api.nekoSearchGroups(query));
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSearchingGroups(false);
    }
  };

  const toggleGroup = (list: "include" | "exclude", g: NekoGroup) => {
    const key = list === "include" ? "includeGroups" : "excludeGroups";
    const vals = nekoFilters[key];
    const next = vals.includes(g.id)
      ? vals.filter((x) => x !== g.id)
      : [...vals, g.id];
    saveNekoFilters({ ...nekoFilters, [key]: next });
    setSetting("nekoGroupNames", {
      ...(settings.nekoGroupNames ?? {}),
      [g.id]: g.displayName,
    });
  };

  const removeGroup = (list: "include" | "exclude", id: string) => {
    const key = list === "include" ? "includeGroups" : "excludeGroups";
    saveNekoFilters({
      ...nekoFilters,
      [key]: nekoFilters[key].filter((x) => x !== id),
    });
  };

  return (
    <div className="grid gap-2.5">
      <Panel className="p-4">
        <Label right={<Radar size={12} strokeWidth={1.75} className="text-accent" />}>
          release tracking
        </Label>
        <div className="mt-3">
          <div className={LBL}>tracker strategy</div>
          <Seg<"auto" | "nyaa" | "neko">
            value={tracker}
            onChange={(v) => setSetting("tracker", v)}
            options={[
              { id: "auto", label: "Smart (best of both)" },
              { id: "nyaa", label: "Nyaa only" },
              { id: "neko", label: "nekoBT only" },
            ]}
          />
          <div className="mt-2 font-mono text-[9.5px] leading-relaxed text-fg-faint">
            {tracker === "auto"
              ? "queries Nyaa and nekoBT at the same time; if one is offline the other is used automatically, and when both respond the result with the most seeders wins (ties: Nyaa)"
              : tracker === "neko"
                ? "only nekoBT is queried — an API key is required"
                : "only the Nyaa API is queried"}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-edge pt-3">
          <Toggle
            checked={settings.autoSearch !== false}
            onChange={(v) => setSetting("autoSearch", v)}
            label="Auto-search (15 min after airing)"
          />
          <Toggle
            checked={settings.notify !== false}
            onChange={(v) => setSetting("notify", v)}
            label="OS notifications"
          />
        </div>
      </Panel>

      <Panel className="p-4">
        <Label right={<span className="font-mono text-[9px] text-fg-faint">both trackers</span>}>
          release title filters
        </Label>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <div className={LBL}>must contain (all)</div>
            <ChipsInput
              values={filters.include}
              onChange={(v) => saveFilters({ ...filters, include: v })}
              placeholder="1080"
              emptyHint="no requirements"
            />
          </div>
          <div>
            <div className={LBL}>exclude (any)</div>
            <ChipsInput
              values={filters.exclude}
              onChange={(v) => saveFilters({ ...filters, exclude: v })}
              placeholder="720"
              tone="danger"
              emptyHint="nothing excluded"
            />
          </div>
        </div>
        <div className="mt-3 border-t border-edge pt-3">
          <Toggle
            checked={filters.enabled}
            onChange={(v) => saveFilters({ ...filters, enabled: v })}
            label="Filters enabled"
          />
        </div>
      </Panel>

      <Panel className="p-4">
        <Label right={<Download size={12} strokeWidth={1.75} className="text-accent" />}>
          nyaa.si
        </Label>
        <div className="mt-1 font-mono text-[9.5px] leading-relaxed text-fg-faint">
          searched through its native RSS feed (anime categories only). results
          are matched per title, so no base URL is needed
        </div>
        <div className="mt-3 border-t border-edge pt-3">
          <div className={LBL}>test search</div>
          <div className="flex gap-1.5">
            <input
              className="input"
              value={nyaTest}
              onChange={(e) => setNyaTest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && testNyaa()}
              placeholder="e.g. One Piece 1122"
            />
            <Btn
              variant="primary"
              onClick={testNyaa}
              disabled={testingNyaa}
              icon={testingNyaa ? <Loader2 size={11} className="animate-spin" /> : undefined}
            >
              Go
            </Btn>
          </div>
          {nyaResults && (
            <div className="mt-2 max-h-40 overflow-y-auto border border-edge bg-surface">
              {nyaResults.length === 0 && (
                <div className="px-2 py-1.5 font-mono text-[10.5px] text-fg-faint">
                  no results
                </div>
              )}
              {nyaResults.slice(0, 10).map((r, i) => (
                <div
                  key={i}
                  className="border-b border-edge px-2 py-1 font-mono text-[10px] text-fg-muted last:border-b-0"
                >
                  <span className="text-moss tnum">{r.seeders}s</span> · {r.title}
                  {r.size ? ` · ${r.size}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <Label right={<Magnet size={12} strokeWidth={1.75} className="text-accent" />}>
          nekobt
        </Label>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <div className={LBL}>API key (ssid cookie)</div>
            <input
              className="input"
              type="password"
              value={settings.nekoKey ?? ""}
              onChange={(e) => setSetting("nekoKey", e.target.value.trim())}
              placeholder="your nekoBT API key"
            />
            <div className="mt-1 font-mono text-[9.5px] text-fg-faint">
              get it from your nekoBT account; stored locally in the app DB
            </div>
          </div>
          <div>
            <div className={LBL}>base URL</div>
            <input
              className="input"
              value={settings.nekoBase ?? ""}
              onChange={(e) => setSetting("nekoBase", e.target.value.trim())}
              placeholder="https://nekobt.to"
            />
          </div>
        </div>

        <div className="mt-4 border-t border-edge pt-3">
          <Label>nekobt filters (api-native)</Label>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <div className={LBL}>subtitle level (0-3, -1 = no subs)</div>
              <div className="flex flex-wrap gap-1.5">
                {[-1, 0, 1, 2, 3].map((l) => {
                  const on = nekoFilters.levels.includes(l);
                  return (
                    <button
                      key={l}
                      className={`chip ${on ? "chip-accent" : ""} cursor-pointer`}
                      onClick={() =>
                        saveNekoFilters({
                          ...nekoFilters,
                          levels: on
                            ? nekoFilters.levels.filter((x) => x !== l)
                            : [...nekoFilters.levels, l],
                        })
                      }
                    >
                      {l === -1 ? "no subs" : `L${l}`}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className={LBL}>flags</div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {(
                  [
                    ["hardsub", "hardsub"],
                    ["batch", "batch"],
                    ["otl", "original TL"],
                    ["mtl", "machine TL"],
                  ] as const
                ).map(([k, label]) => (
                  <Toggle
                    key={k}
                    checked={nekoFilters[k] === true}
                    onChange={(v) =>
                      saveNekoFilters({ ...nekoFilters, [k]: v ? true : null })
                    }
                    label={label}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <div className={LBL}>audio lang</div>
              <input
                className="input"
                value={nekoFilters.audioLang.join(",")}
                onChange={(e) =>
                  saveNekoFilters({
                    ...nekoFilters,
                    audioLang: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="ja"
              />
            </div>
            <div>
              <div className={LBL}>fansub lang</div>
              <input
                className="input"
                value={nekoFilters.fsubLang.join(",")}
                onChange={(e) =>
                  saveNekoFilters({
                    ...nekoFilters,
                    fsubLang: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="en"
              />
            </div>
            <div>
              <div className={LBL}>sub lang</div>
              <input
                className="input"
                value={nekoFilters.subLang.join(",")}
                onChange={(e) =>
                  saveNekoFilters({
                    ...nekoFilters,
                    subLang: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="en"
              />
            </div>
          </div>

          <div className="mt-4 border-t border-edge pt-3">
            <Label>groups</Label>
            <div className="mt-3">
              <GroupPicker
                includeIds={nekoFilters.includeGroups}
                excludeIds={nekoFilters.excludeGroups}
                names={settings.nekoGroupNames ?? {}}
                results={groupResults}
                searching={searchingGroups}
                onSearch={searchGroups}
                onToggle={toggleGroup}
                onRemove={removeGroup}
              />
            </div>
          </div>

          <div className="mt-3 border-t border-edge pt-3">
            <Toggle
              checked={nekoFilters.enabled}
              onChange={(v) => saveNekoFilters({ ...nekoFilters, enabled: v })}
              label="nekoBT filters enabled"
            />
          </div>
        </div>

        <div className="mt-4 border-t border-edge pt-3">
          <div className={LBL}>test search</div>
          <div className="flex gap-1.5">
            <input
              className="input"
              value={nekoTest}
              onChange={(e) => setNekoTest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && testNeko()}
              placeholder="e.g. One Piece"
            />
            <Btn
              variant="primary"
              onClick={testNeko}
              disabled={testingNeko}
              icon={testingNeko ? <Loader2 size={11} className="animate-spin" /> : undefined}
            >
              Go
            </Btn>
          </div>
          {nekoResults && (
            <div className="mt-2 max-h-40 overflow-y-auto border border-edge bg-surface">
              {nekoResults.length === 0 && (
                <div className="px-2 py-1.5 font-mono text-[10.5px] text-fg-faint">
                  no results
                </div>
              )}
              {nekoResults.slice(0, 10).map((r, i) => (
                <div
                  key={i}
                  className="border-b border-edge px-2 py-1 font-mono text-[10px] text-fg-muted last:border-b-0"
                >
                  <span className="text-moss tnum">{r.seeders ?? "0"}s</span> · {r.title}
                  {r.groups?.length
                    ? ` · [${r.groups.map((g) => g.displayName ?? g.name).filter(Boolean).join(", ")}]`
                    : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-1.5 font-mono text-[9.5px] text-fg-faint">
          <CircleCheck size={10} strokeWidth={1.75} className="text-moss" />
          preferred groups also tag-match Nyaa releases by fansub name
        </div>
      </Panel>
    </div>
  );
}
