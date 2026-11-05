import { Loader2, MonitorPlay, Palette } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { ACCENT_PRESETS } from "../../lib/types";
import type { ViewMode } from "../../lib/types";
import { useStore } from "../../store";
import { Btn, Label, Panel, Seg, Toggle } from "../../components/ui";

export function GeneralSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [mpvStatus, setMpvStatus] = useState<string | null>(null);
  const [testingMpv, setTestingMpv] = useState(false);

  const testMpv = async () => {
    setTestingMpv(true);
    try {
      setMpvStatus(await api.checkMpv());
    } catch (e) {
      setMpvStatus(String(e));
    } finally {
      setTestingMpv(false);
    }
  };

  return (
    <div className="grid gap-2.5">
      <Panel className="p-4">
        <Label right={<Palette size={12} strokeWidth={1.75} className="text-accent" />}>
          appearance
        </Label>
        <div className="mt-3 grid gap-4">
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
              theme
            </div>
            <Seg<"dark" | "light">
              value={settings.theme ?? "dark"}
              onChange={(v) => setSetting("theme", v)}
              options={[
                { id: "dark", label: "Sumi (dark)" },
                { id: "light", label: "Washi (light)" },
              ]}
            />
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
              accent color
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  className={`h-6 w-6 border transition-transform hover:scale-110 ${
                    settings.accent === c ? "border-fg" : "border-edge"
                  }`}
                  style={{
                    background: c,
                    boxShadow:
                      settings.accent === c
                        ? `inset 0 0 0 2px var(--surface)`
                        : undefined,
                  }}
                  title={c}
                  onClick={() => setSetting("accent", c)}
                />
              ))}
              <input
                type="color"
                value={settings.accent ?? "#e2543e"}
                onChange={(e) => setSetting("accent", e.target.value)}
                className="h-6 w-8 cursor-pointer border border-edge bg-transparent"
                title="Custom color"
              />
            </div>
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
              default list view
            </div>
            <Seg<ViewMode>
              value={settings.listView ?? "list"}
              onChange={(v) => setSetting("listView", v)}
              options={[
                { id: "list", label: "List (mini covers)" },
                { id: "grid", label: "Grid (posters)" },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel className="p-4">
        <Label
          right={<MonitorPlay size={12} strokeWidth={1.75} className="text-accent" />}
        >
          playback
        </Label>
        <div className="mt-3 grid gap-2.5">
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
              where torrent data lives
            </div>
            <Seg<"ram" | "disk">
              value={settings.streamMode ?? "ram"}
              onChange={(v) => setSetting("streamMode", v)}
              options={[
                { id: "ram", label: "RAM (full file)" },
                { id: "disk", label: "Disk" },
              ]}
            />
            <div className="mt-2 font-mono text-[9.5px] leading-relaxed text-fg-faint">
              {settings.streamMode === "disk" ? (
                <>
                  downloads into cache\torrents next to the app (SSD/HDD
                  writes). the only mode where "delete after watch" applies
                </>
              ) : (
                <>
                  the whole episode is held in memory, freed when playback
                  ends. files over 4 GB automatically fall back to disk
                </>
              )}
            </div>
          </div>
          <div className="border-t border-edge pt-2.5">
            <Toggle
              checked={settings.deleteAfterWatch === true}
              onChange={(v) => setSetting("deleteAfterWatch", v)}
              label="Delete downloaded files when playback ends"
            />
            <div className="mt-1 font-mono text-[9.5px] leading-relaxed text-fg-faint">
              only relevant with Disk mode; removes the episode from
              cache\torrents after you finish or close the player
            </div>
          </div>
        </div>
        <div className="mt-3 border-t border-edge pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
            default tracks
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-faint">
                audio language
              </span>
              <input
                className="input"
                value={settings.audioLang ?? ""}
                onChange={(e) => setSetting("audioLang", e.target.value)}
                placeholder="e.g. ja,jpn"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-faint">
                subtitle language
              </span>
              <input
                className="input"
                value={settings.subLang ?? ""}
                onChange={(e) => setSetting("subLang", e.target.value)}
                placeholder="e.g. en,eng"
              />
            </label>
          </div>
          <div className="mt-2 font-mono text-[9.5px] leading-relaxed text-fg-faint">
            comma-separated language tags tried in order. leave both empty to
            use the file's default tracks. you can still switch tracks for the
            current episode from the player bar.
          </div>
        </div>
        <div className="mt-3 border-t border-edge pt-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-faint">
            external mpv (fallback)
          </div>
          <input
            className="input"
            value={settings.mpvPath ?? ""}
            onChange={(e) => setSetting("mpvPath", e.target.value)}
            placeholder="mpv (PATH) or full path, e.g. E:\mpv\mpv.exe"
          />
          <div className="mt-2 flex items-center gap-2">
            <Btn
              size="sm"
              onClick={testMpv}
              disabled={testingMpv}
              icon={
                testingMpv ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <MonitorPlay size={11} strokeWidth={1.75} />
                )
              }
            >
              Test
            </Btn>
            {mpvStatus && (
              <span
                className={`font-mono text-[10.5px] ${
                  mpvStatus.startsWith("mpv") ? "text-moss" : "text-danger"
                }`}
              >
                {mpvStatus}
              </span>
            )}
          </div>
          <div className="mt-2 font-mono text-[9.5px] leading-relaxed text-fg-faint">
            the built-in player (libmpv) is used when libmpv-2.dll sits next to
            the exe; external mpv.exe plays the same stream otherwise. the
            language preferences above apply to both, volume starts at 60%
          </div>
        </div>
      </Panel>
    </div>
  );
}
