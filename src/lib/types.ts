export interface EntryView {
  id: number;
  anilistId: number;
  mediaType: "ANIME" | "MANGA";
  status: string;
  customListId: number | null;
  score: number;
  progress: number;
  rewatches: number;
  startDate: string | null;
  finishDate: string | null;
  notes: string;
  addedAt: number;
  title: string | null;
  titleEnglish: string | null;
  titleNative: string | null;
  format: string | null;
  mediaStatus: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  coverUrl: string | null;
  coverFile: string | null;
  averageScore: number | null;
  genres: string | null;
  season: string | null;
  seasonYear: number | null;
  total: number | null;
  duration: number | null;
}

export interface MediaSummary {
  id: number;
  idMal: number | null;
  mediaType: string;
  format: string | null;
  status: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  titleRomaji: string | null;
  titleEnglish: string | null;
  titleNative: string | null;
  coverUrl: string | null;
  description: string | null;
  averageScore: number | null;
  genres: string[] | null;
  season: string | null;
  seasonYear: number | null;
  inList: string | null;
}

export interface ReleaseRow {
  id: number;
  anilistId: number;
  episode: number;
  title: string;
  url: string | null;
  magnet: string | null;
  torrent: string | null;
  size: string | null;
  seeders: number;
  leechers: number;
  foundAt: number | null;
  seen: number;
}

export interface ScheduleView {
  anilistId: number;
  episode: number;
  airingAt: number;
  titleRomaji: string | null;
  titleEnglish: string | null;
  titleNative: string | null;
  coverUrl: string | null;
  mediaJson: Record<string, unknown> | null;
  searched: boolean;
  inList: boolean;
  entryId: number | null;
  entryStatus: string | null;
  entryProgress: number | null;
  releases: ReleaseRow[];
}

export interface CustomList {
  id: number;
  mediaType: string;
  name: string;
  position: number;
}

export interface NyaaFilters {
  enabled: boolean;
  include: string[];
  exclude: string[];
}

export interface NekoFilters {
  enabled: boolean;
  levels: number[];
  audioLang: string[];
  fsubLang: string[];
  subLang: string[];
  hardsub: boolean | null;
  batch: boolean | null;
  otl: boolean | null;
  mtl: boolean | null;
  includeGroups: string[];
  excludeGroups: string[];
}

export interface NekoGroup {
  id: string;
  name: string;
  displayName: string;
  tag: string;
  displayTag: string;
  tagline: string | null;
  pfpHash: string | null;
  torrentCount: string | null;
  downloadCount: string | null;
}

export interface NekoTorrent {
  id: string;
  title: string;
  magnet: string | null;
  privateMagnet: string | null;
  filesize: string | null;
  seeders: string | null;
  leechers: string | null;
  completed: string | null;
  mediaId: string | null;
  mediaEpisodeIds: string[] | null;
  videoType: number | null;
  videoCodec: number | null;
  level: number | null;
  audioLang: string | null;
  subLang: string | null;
  fsubLang: string | null;
  hardsub: boolean | null;
  batch: boolean | null;
  otl: boolean | null;
  mtl: boolean | null;
  uploadedAt: string | null;
  groups: { id: string; name: string | null; displayName: string | null; uploadingGroup: boolean | null }[] | null;
  imported: number | null;
}

export interface NyaaResult {
  id: string;
  title: string;
  size: string | null;
  date: string | null;
  seeders: number;
  leechers: number;
  downloads: number;
  url: string | null;
  magnet: string | null;
  torrent: string | null;
}

export interface ScheduleStatus {
  count: number;
  lastSync: number | null;
  syncing: boolean;
  searching: boolean;
}

export interface ImportReport {
  added: number;
  skipped: number;
  failed: number;
  notFound: string[];
}

export interface PullReport {
  added: number;
  updated: number;
  keptLocal: number;
  customListsCreated: number;
}

export type TabId =
  | { kind: "airing"; mediaType: "ANIME" }
  | { kind: "list"; mediaType: "ANIME" | "MANGA"; status?: string; customListId?: number }
  | { kind: "stats" }
  | { kind: "settings" };

export interface QueueItem {
  id: number;
  title: string;
  magnet: string;
  size: string | null;
  addedAt: number;
  entryId: number | null;
  episode: number | null;
}

export interface GapRow {
  anilistId: number;
  title: string | null;
  progress: number;
  latestReleaseEp: number | null;
  latestReleaseAt: number | null;
}

export interface ActivityDay {
  day: string;
  mediaType: "ANIME" | "MANGA";
  count: number;
}

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export type ViewMode = "list" | "grid";

export interface TrackInfo {
  id: number;
  type: "audio" | "sub" | string;
  lang: string | null;
  title: string | null;
  codec: string | null;
  selected: boolean;
  default: boolean;
  external: boolean;
}

export interface AppSettings {
  theme?: "dark" | "light";
  accent?: string;
  listView?: ViewMode;
  mpvPath?: string;
  nyaaFilters?: NyaaFilters;
  nekoBase?: string;
  nekoKey?: string;
  nekoFilters?: NekoFilters;
  nekoGroupNames?: Record<string, string>;
  tracker?: "auto" | "nyaa" | "neko";
  autoSearch?: boolean;
  notify?: boolean;
  anilistClientId?: string;
  anilistUsername?: string;
  anilistSync?: boolean;
  queueAutoAdvance?: boolean;
  streamMode?: "ram" | "disk";
  deleteAfterWatch?: boolean;
  audioLang?: string;
  subLang?: string;
  timeZone?: string;
}

export const STATUSES = ["CURRENT", "COMPLETED", "PAUSED", "DROPPED", "PLANNING"] as const;
export type Status = (typeof STATUSES)[number];

export function statusLabel(s: string, manga: boolean): string {
  switch (s) {
    case "CURRENT":
      return manga ? "Reading" : "Watching";
    case "COMPLETED":
      return "Completed";
    case "PAUSED":
      return "Paused";
    case "DROPPED":
      return "Dropped";
    case "PLANNING":
      return manga ? "Plan to Read" : "Plan to Watch";
    default:
      return s;
  }
}

export type ScoreTier = "bad" | "mid" | "good" | "great";

export function scoreTier(score: number): ScoreTier | null {
  if (score <= 0) return null;
  if (score <= 3) return "bad";
  if (score <= 6) return "mid";
  if (score <= 8) return "good";
  return "great";
}

export const SCORE_TIERS: {
  tier: ScoreTier;
  label: string;
  range: string;
  value: number;
  face: string;
}[] = [
  { tier: "bad", label: "bad", range: "1–3", value: 2, face: ":c" },
  { tier: "mid", label: "mid", range: "4–6", value: 5, face: ":I" },
  { tier: "good", label: "good", range: "7–8", value: 8, face: ":)" },
  { tier: "great", label: "very good", range: "9–10", value: 10, face: ":D" },
];

export const SCORE_TIER_COLOR: Record<ScoreTier, string> = {
  bad: "var(--danger)",
  mid: "var(--fg-muted)",
  good: "var(--moss)",
  great: "var(--ochre)",
};

export const ACCENT_PRESETS = [
  "#e2543e", // vermilion (shu)
  "#c8442f", // beni
  "#bf8f3f", // ochre
  "#c2a14b", // gold
  "#7d9268", // moss
  "#4f9488", // asagi
  "#5c82b0", // ai
  "#8a6fb0", // fuji
  "#b5638f", // plum
  "#9c6b4f", // umber
];

export const DEFAULT_TIME_ZONE = "America/New_York";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/// Every IANA timezone exposed by the host. WebView2 is Chromium-based, so
/// supportedValuesOf is available; the fallback keeps the picker usable on
/// older engines instead of rendering an empty list.
export function timeZoneOptions(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  let zones: string[] = [];
  if (typeof supported === "function") {
    try {
      zones = supported("timeZone");
    } catch {
      zones = [];
    }
  }
  for (const zone of [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Australia/Sydney",
  ]) {
    if (!zones.includes(zone)) zones.push(zone);
  }
  return zones.sort((a, b) => a.localeCompare(b));
}

export function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayIndex(atSeconds: number, timeZone: string): number {
  // 0 = Sunday .. 6 = Saturday, matching Date.getDay()
  const s = new Date(atSeconds * 1000).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone,
  });
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[s] ?? new Date(atSeconds * 1000).getDay();
}

export function hourMinute(atSeconds: number, timeZone: string): string {
  return formatInZone(
    atSeconds,
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    timeZone,
  );
}

function formatInZone(
  atSeconds: number,
  opts: Intl.DateTimeFormatOptions,
  timeZone: string,
): string {
  const s = new Date(atSeconds * 1000).toLocaleTimeString("en-US", {
    ...opts,
    timeZone,
  });
  return s.replace(/^24/, "00");
}

export function fmtCountdown(airingAt: number): string {
  const diff = airingAt * 1000 - Date.now();
  if (diff <= 0) return "now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}