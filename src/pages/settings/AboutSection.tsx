import { Info, MousePointerClick } from "lucide-react";
import { Kbd, Label, Panel } from "../../components/ui";

export function AboutSection() {
  return (
    <div className="grid gap-2.5">
      <Panel className="p-4">
        <Label right={<Info size={12} strokeWidth={1.75} className="text-accent" />}>
          about
        </Label>
        <div className="mt-3 text-[11.5px] leading-relaxed text-fg-muted">
          EstenyacList · Tauri 2 + Tailwind v4. Anime data from the AniList GraphQL
          API (polled politely at ~26 req/min). Release tracking via the Nyaa RSS
          feed and the nekoBT API (smart mode picks the tracker with more seeders,
          or whichever is online). Covers are cached locally as JPEG XL (quality
          95) only for entries on your lists. Torrents stream through the embedded
          rqbit engine into the built-in player (libmpv), or external mpv when
          libmpv-2.dll is not present — no userscript needed.
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-edge pt-3 font-mono text-[9.5px] text-fg-faint">
          <MousePointerClick size={11} strokeWidth={1.75} className="text-accent" />
          tip: hover entries in a list and press <Kbd>+</Kbd> / <Kbd>−</Kbd> to bump
          progress
        </div>
      </Panel>
    </div>
  );
}
