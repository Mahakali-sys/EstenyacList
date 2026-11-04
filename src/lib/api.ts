import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityDay,
  BackupInfo,
  CustomList,
  EntryView,
  GapRow,
  ImportReport,
  MediaSummary,
  NekoGroup,
  NekoTorrent,
  NyaaResult,
  PullReport,
  QueueItem,
  ReleaseRow,
  ScheduleStatus,
  ScheduleView,
} from "./types";

export const api = {
  getDbPath: () => invoke<string>("get_db_path"),

  getEntries: (
    mediaType?: string,
    status?: string,
    customListId?: number,
  ) =>
    invoke<EntryView[]>("get_entries", {
      mediaType,
      status,
      customListId,
    }),

  getEntry: (id: number) => invoke<EntryView>("get_entry", { id }),

  addEntry: (anilistId: number, mediaType: string, status: string) =>
    invoke<EntryView>("add_entry", { anilistId, mediaType, status }),

  removeEntry: (id: number) => invoke<void>("remove_entry", { id }),

  updateEntry: (patch: {
    id: number;
    status?: string;
    customListId?: number | null;
    score?: number;
    progress?: number;
    rewatches?: number;
    startDate?: string | null;
    finishDate?: string | null;
    notes?: string;
  }) => invoke<EntryView>("update_entry", patch),

  getCustomLists: () => invoke<CustomList[]>("get_custom_lists"),
  createCustomList: (mediaType: string, name: string) =>
    invoke<number>("create_custom_list", { mediaType, name }),
  renameCustomList: (id: number, name: string) =>
    invoke<void>("rename_custom_list", { id, name }),
  deleteCustomList: (id: number) => invoke<void>("delete_custom_list", { id }),
  reorderCustomLists: (ids: number[]) =>
    invoke<void>("reorder_custom_lists", { ids }),

  getActivity: () => invoke<ActivityDay[]>("get_activity"),

  searchAnilist: (query: string, mediaType: string) =>
    invoke<MediaSummary[]>("search_anilist", { query, mediaType }),
  searchLocal: (query: string, mediaType: string) =>
    invoke<EntryView[]>("search_entries", { query, mediaType }),
  getMedia: (anilistId: number) =>
    invoke<Record<string, unknown>>("get_media", { anilistId }),

  scheduleNextWeek: () => invoke<ScheduleView[]>("schedule_next_week"),
  scheduleStatus: () => invoke<ScheduleStatus>("schedule_status"),
  resyncSchedule: () => invoke<number>("resync_schedule"),

  imageData: (anilistId: number) =>
    invoke<string | null>("image_data", { anilistId }),
  clearImageCache: () => invoke<void>("clear_image_cache"),
  redownloadCovers: () => invoke<number>("redownload_covers"),

  getReleases: (anilistId: number) =>
    invoke<ReleaseRow[]>("get_releases", { anilistId }),
  markReleaseSeen: (id: number) => invoke<void>("mark_release_seen", { id }),
  clearReleases: (anilistId: number) =>
    invoke<void>("clear_releases", { anilistId }),
  searchReleasesNow: (anilistId: number, episode: number) =>
    invoke<number>("search_releases_now", { anilistId, episode }),

  nyaaTest: (query: string) => invoke<NyaaResult[]>("nyaa_test", { query }),

  nekoTest: (query: string) => invoke<NekoTorrent[]>("neko_test", { query }),
  nekoSearchGroups: (query: string) =>
    invoke<NekoGroup[]>("neko_search_groups", { query }),
  getMediaGroups: (anilistId: number) =>
    invoke<[string[], string[]]>("get_media_groups", { anilistId }),
  setMediaGroups: (
    anilistId: number,
    include: string[],
    exclude: string[],
  ) => invoke<void>("set_media_groups", { anilistId, include, exclude }),
  getSearchNames: (anilistId: number) =>
    invoke<string[]>("get_search_names", { anilistId }),
  setSearchNames: (anilistId: number, names: string[]) =>
    invoke<void>("set_search_names", { anilistId, names }),
  getReleaseFilters: (anilistId: number) =>
    invoke<string[]>("get_release_filters", { anilistId }),
  setReleaseFilters: (anilistId: number, patterns: string[]) =>
    invoke<void>("set_release_filters", { anilistId, patterns }),
  getQualityPrefs: (anilistId: number) =>
    invoke<string[]>("get_quality_prefs", { anilistId }),
  setQualityPrefs: (anilistId: number, patterns: string[]) =>
    invoke<void>("set_quality_prefs", { anilistId, patterns }),

  checkMpv: () => invoke<string>("check_mpv"),

  playerOpen: (
    source: string,
    title?: string | null,
    entryId?: number | null,
    episode?: number | null,
  ) => invoke<void>("player_open", { source, title, entryId, episode }),
  playerAvailable: () => invoke<boolean>("player_available"),
  playerTogglePause: () => invoke<void>("player_toggle_pause"),
  playerSetPaused: (paused: boolean) =>
    invoke<void>("player_set_paused", { paused }),
  playerSeek: (seconds: number) => invoke<void>("player_seek", { seconds }),
  playerSeekRel: (seconds: number) =>
    invoke<void>("player_seek_rel", { seconds }),
  playerSetVolume: (volume: number) =>
    invoke<void>("player_set_volume", { volume }),
  playerClose: () => invoke<void>("player_close"),

  getSettings: () => invoke<Record<string, unknown>>("get_settings"),
  setSettings: (key: string, value: unknown) =>
    invoke<void>("set_settings", { key, value }),

  anilistConnect: (clientId: string, clientSecret: string, code: string) =>
    invoke<{ username: string; scoreFormat: string }>("anilist_connect", {
      clientId,
      clientSecret,
      code,
    }),
  anilistDisconnect: () => invoke<void>("anilist_disconnect"),
  anilistPushEntry: (id: number) =>
    invoke<void>("anilist_push_entry", { id }),
  anilistPull: () => invoke<PullReport>("anilist_pull"),

  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openAniListAuth: (clientId: string) =>
    invoke<void>("open_anilist_auth", { clientId }),
  openAniListDeveloper: () => invoke<void>("open_anilist_developer"),

  exportMal: () => invoke<string>("export_mal"),
  importMal: () => invoke<ImportReport>("import_mal"),

  queueList: () => invoke<QueueItem[]>("queue_list"),
  queueAdd: (
    title: string,
    magnet: string,
    size?: string,
    entryId?: number | null,
    episode?: number | null,
  ) => invoke<number>("queue_add", { title, magnet, size, entryId, episode }),
  queueRemove: (id: number) => invoke<void>("queue_remove", { id }),
  queueClear: () => invoke<void>("queue_clear"),
  queueReorder: (ids: number[]) => invoke<void>("queue_reorder", { ids }),

  gapReport: () => invoke<GapRow[]>("gap_report"),

  runBackup: (force?: boolean) =>
    invoke<string>("run_backup", { force }),
  listBackups: () => invoke<BackupInfo[]>("list_backups"),
  restoreBackup: (name?: string) => invoke<ImportReport>("restore_backup", { name }),
};