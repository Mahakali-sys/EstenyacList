import { useState } from "react";
import { AboutSection } from "./AboutSection";
import { DataSection } from "./DataSection";
import { GeneralSection } from "./GeneralSection";
import { SyncSection } from "./SyncSection";
import { TrackersSection } from "./TrackersSection";

type SectionId = "general" | "sync" | "trackers" | "data" | "about";

const SECTIONS: { id: SectionId; label: string; sub: string }[] = [
  { id: "general", label: "General", sub: "appearance · timezone · playback" },
  { id: "sync", label: "AniList", sub: "account · sync" },
  { id: "trackers", label: "Releases", sub: "trackers · filters" },
  { id: "data", label: "Data", sub: "import · backups · covers" },
  { id: "about", label: "About", sub: "what this is" },
];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>("general");

  return (
    <div className="flex flex-1 overflow-hidden">
      <nav className="w-44 shrink-0 overflow-y-auto border-r border-edge py-3">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`w-full border-l-2 px-3 py-2 text-left transition-colors ${
              section === s.id
                ? "border-accent bg-accent/5"
                : "border-transparent hover:bg-surface-2/50"
            }`}
          >
            <div
              className={`text-[12px] font-semibold ${
                section === s.id ? "text-accent" : "text-fg-muted"
              }`}
            >
              {s.label}
            </div>
            <div className="font-mono text-[9px] text-fg-faint">{s.sub}</div>
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-3xl pb-10">
          {section === "general" && <GeneralSection />}
          {section === "sync" && <SyncSection />}
          {section === "trackers" && <TrackersSection />}
          {section === "data" && <DataSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
