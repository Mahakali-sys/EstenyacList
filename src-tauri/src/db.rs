use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn db_path() -> PathBuf {
    exe_dir().join("estenyac_list.db")
}

pub fn cache_dir() -> PathBuf {
    exe_dir().join("cache").join("images")
}

pub fn log_path() -> PathBuf {
    exe_dir().join("estenyac_search.log")
}

pub fn append_log(line: &str) {
    use std::io::Write;
    // unbounded: every release search appends several diagnostic lines
    const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;
    let path = log_path();
    if std::fs::metadata(&path)
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let ts = chrono::Utc::now().format("%H:%M:%S");
        let _ = writeln!(f, "[{ts}] {line}");
    }
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS media (
  anilist_id   INTEGER PRIMARY KEY,
  mal_id       INTEGER,
  type         TEXT NOT NULL,
  title_romaji TEXT,
  title_english TEXT,
  title_native TEXT,
  format       TEXT,
  status       TEXT,
  episodes     INTEGER,
  chapters     INTEGER,
  volumes      INTEGER,
  cover_url    TEXT,
  cover_file   TEXT,
  description  TEXT,
  average_score INTEGER,
  genres       TEXT,
  studios      TEXT,
  season       TEXT,
  season_year  INTEGER,
  duration     INTEGER,
  updated_at   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  anilist_id     INTEGER NOT NULL REFERENCES media(anilist_id) ON DELETE CASCADE,
  media_type     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'CURRENT',
  custom_list_id INTEGER,
  score          INTEGER NOT NULL DEFAULT 0,
  progress       INTEGER NOT NULL DEFAULT 0,
  rewatches      INTEGER NOT NULL DEFAULT 0,
  start_date     TEXT,
  finish_date    TEXT,
  notes          TEXT DEFAULT '',
  added_at       INTEGER DEFAULT (unixepoch()),
  UNIQUE(anilist_id, media_type)
);

CREATE TABLE IF NOT EXISTS custom_lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  media_type TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER DEFAULT 0,
  UNIQUE(media_type, name)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS schedule (
  anilist_id  INTEGER NOT NULL,
  episode     INTEGER NOT NULL,
  airing_at   INTEGER NOT NULL,
  title_romaji TEXT,
  title_english TEXT,
  title_native TEXT,
  cover_url   TEXT,
  media_json  TEXT,
  searched    INTEGER DEFAULT 0,
  asked       INTEGER DEFAULT 0,
  PRIMARY KEY (anilist_id, episode)
);

CREATE TABLE IF NOT EXISTS releases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  anilist_id INTEGER NOT NULL,
  episode    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT,
  magnet     TEXT,
  torrent    TEXT,
  size       TEXT,
  seeders    INTEGER DEFAULT 0,
  leechers   INTEGER DEFAULT 0,
  found_at   INTEGER,
  seen       INTEGER DEFAULT 0,
  UNIQUE(anilist_id, episode, title)
);

CREATE TABLE IF NOT EXISTS media_groups (
  anilist_id INTEGER PRIMARY KEY,
  include    TEXT DEFAULT '[]',
  exclude    TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS search_names (
  anilist_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  PRIMARY KEY (anilist_id, name)
);

CREATE TABLE IF NOT EXISTS release_filters (
  anilist_id INTEGER NOT NULL,
  pattern    TEXT NOT NULL,
  PRIMARY KEY (anilist_id, pattern)
);

CREATE TABLE IF NOT EXISTS quality_prefs (
  anilist_id INTEGER NOT NULL,
  pattern    TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (anilist_id, pattern)
);

CREATE TABLE IF NOT EXISTS activity (
  day        TEXT NOT NULL,
  media_type TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, media_type)
);

CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_custom ON entries(custom_list_id);
CREATE INDEX IF NOT EXISTS idx_entries_media_status ON entries(media_type, status);
CREATE INDEX IF NOT EXISTS idx_schedule_time ON schedule(airing_at);
CREATE INDEX IF NOT EXISTS idx_releases_anilist ON releases(anilist_id, episode);

CREATE TABLE IF NOT EXISTS magnet_queue (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  title    TEXT NOT NULL,
  magnet   TEXT NOT NULL,
  size     TEXT,
  added_at INTEGER DEFAULT (unixepoch()),
  entry_id INTEGER,
  episode  INTEGER,
  sort_order INTEGER
);
"#;

impl Db {
    pub fn open() -> Db {
        let path = db_path();
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(&path).expect("failed to open sqlite database");
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "foreign_keys", "ON").ok();
        conn.execute_batch(SCHEMA).expect("failed to init schema");
        // migration for databases created before rewatch counters existed
        let _ = conn.execute(
            "ALTER TABLE entries ADD COLUMN rewatches INTEGER NOT NULL DEFAULT 0",
            [],
        );
        // queue attribution (auto-advance progress bumps)
        let _ = conn.execute("ALTER TABLE magnet_queue ADD COLUMN entry_id INTEGER", []);
        let _ = conn.execute("ALTER TABLE magnet_queue ADD COLUMN episode INTEGER", []);
        // user-defined queue order
        let _ = conn.execute("ALTER TABLE magnet_queue ADD COLUMN sort_order INTEGER", []);
        let _ = conn.execute(
            "UPDATE magnet_queue SET sort_order = id WHERE sort_order IS NULL",
            [],
        );
        Db(Mutex::new(conn))
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---------- media ----------

    pub fn media_get(&self, id: i64) -> Option<serde_json::Value> {
        let c = self.conn();
        c.query_row(
            "SELECT json_object(
               'anilistId', anilist_id, 'malId', mal_id, 'type', type,
               'titleRomaji', title_romaji, 'titleEnglish', title_english, 'titleNative', title_native,
               'format', format, 'status', status, 'episodes', episodes, 'chapters', chapters,
               'volumes', volumes, 'coverUrl', cover_url, 'coverFile', cover_file,
               'description', description, 'averageScore', average_score, 'genres', genres,
               'studios', studios, 'season', season, 'seasonYear', season_year, 'duration', duration)
             FROM media WHERE anilist_id = ?1",
            params![id],
            |r: &Row| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    }

    pub fn media_upsert(&self, m: &MediaRow) -> rusqlite::Result<()> {
        let c = self.conn();
        c.execute(
            "INSERT INTO media (anilist_id, mal_id, type, title_romaji, title_english, title_native,
                format, status, episodes, chapters, volumes, cover_url, description, average_score,
                genres, studios, season, season_year, duration, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19, unixepoch())
             ON CONFLICT(anilist_id) DO UPDATE SET
               mal_id = COALESCE(excluded.mal_id, media.mal_id),
               title_romaji = COALESCE(excluded.title_romaji, media.title_romaji),
               title_english = COALESCE(excluded.title_english, media.title_english),
               title_native = COALESCE(excluded.title_native, media.title_native),
               format = COALESCE(excluded.format, media.format),
               status = COALESCE(excluded.status, media.status),
               episodes = COALESCE(excluded.episodes, media.episodes),
               chapters = COALESCE(excluded.chapters, media.chapters),
               volumes = COALESCE(excluded.volumes, media.volumes),
               cover_url = COALESCE(excluded.cover_url, media.cover_url),
               description = COALESCE(excluded.description, media.description),
               average_score = COALESCE(excluded.average_score, media.average_score),
               genres = COALESCE(excluded.genres, media.genres),
               studios = COALESCE(excluded.studios, media.studios),
               season = COALESCE(excluded.season, media.season),
               season_year = COALESCE(excluded.season_year, media.season_year),
               duration = COALESCE(excluded.duration, media.duration),
               updated_at = unixepoch()",
            params![
                m.anilist_id,
                m.mal_id,
                m.media_type,
                m.title_romaji,
                m.title_english,
                m.title_native,
                m.format,
                m.status,
                m.episodes,
                m.chapters,
                m.volumes,
                m.cover_url,
                m.description,
                m.average_score,
                m.genres,
                m.studios,
                m.season,
                m.season_year,
                m.duration
            ],
        )?;
        Ok(())
    }

    pub fn media_set_cover_file(&self, id: i64, file: &str) {
        let c = self.conn();
        let _ = c.execute(
            "UPDATE media SET cover_file = ?1, updated_at = unixepoch() WHERE anilist_id = ?2",
            params![file, id],
        );
    }

    pub fn media_set_mal_id(&self, id: i64, mal_id: i64) {
        let c = self.conn();
        let _ = c.execute(
            "UPDATE media SET mal_id = ?1 WHERE anilist_id = ?2",
            params![mal_id, id],
        );
    }

    pub fn media_clear_covers(&self) {
        let c = self.conn();
        let _ = c.execute("UPDATE media SET cover_file = NULL", []);
    }

    /// AniList ids of listed anime whose cached media row has no duration.
    /// Used by the startup backfill so watch-time stats use real lengths
    /// instead of the 24-minute fallback.
    pub fn media_missing_duration(&self) -> Vec<i64> {
        let c = self.conn();
        let mut st = match c.prepare(
            "SELECT DISTINCT e.anilist_id FROM entries e
             JOIN media m ON m.anilist_id = e.anilist_id
             WHERE e.media_type = 'ANIME' AND m.duration IS NULL",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        st.query_map([], |r| r.get::<_, i64>(0))
            .map(|it| it.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    // ---------- entries ----------

    fn entry_from_row(r: &Row) -> rusqlite::Result<EntryView> {
        Ok(EntryView {
            id: r.get(0)?,
            anilist_id: r.get(1)?,
            media_type: r.get(2)?,
            status: r.get(3)?,
            custom_list_id: r.get(4)?,
            score: r.get(5)?,
            progress: r.get(6)?,
            rewatches: r.get(7)?,
            start_date: r.get(8)?,
            finish_date: r.get(9)?,
            notes: r.get(10)?,
            added_at: r.get(11)?,
            title: r.get(12)?,
            title_english: r.get(13)?,
            title_native: r.get(14)?,
            format: r.get(15)?,
            media_status: r.get(16)?,
            episodes: r.get(17)?,
            chapters: r.get(18)?,
            volumes: r.get(19)?,
            cover_url: r.get(20)?,
            cover_file: r.get(21)?,
            average_score: r.get(22)?,
            genres: r.get(23)?,
            season: r.get(24)?,
            season_year: r.get(25)?,
            total: r.get(26)?,
            duration: r.get(27)?,
        })
    }

    const ENTRY_SELECT: &'static str = "SELECT e.id, e.anilist_id, e.media_type, e.status, e.custom_list_id,
              e.score, e.progress, e.rewatches, e.start_date, e.finish_date, e.notes, e.added_at,
              m.title_romaji, m.title_english, m.title_native, m.format, m.status, m.episodes,
              m.chapters, m.volumes, m.cover_url, m.cover_file, m.average_score, m.genres,
              m.season, m.season_year,
              CASE WHEN e.media_type = 'MANGA' THEN m.chapters ELSE m.episodes END,
              m.duration
            FROM entries e JOIN media m ON m.anilist_id = e.anilist_id";

    pub fn entries_get(
        &self,
        media_type: Option<&str>,
        status: Option<&str>,
        custom_list_id: Option<i64>,
    ) -> Vec<EntryView> {
        let c = self.conn();
        let mut sql = String::from(Self::ENTRY_SELECT);
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(t) = media_type {
            conds.push("e.media_type = ?".into());
            args.push(rusqlite::types::Value::Text(t.into()));
        }
        if let Some(s) = status {
            conds.push("e.status = ?".into());
            args.push(rusqlite::types::Value::Text(s.into()));
        }
        if let Some(cid) = custom_list_id {
            conds.push("e.custom_list_id = ?".into());
            args.push(rusqlite::types::Value::Integer(cid));
        }
        if !conds.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conds.join(" AND "));
        }
        sql.push_str(" ORDER BY e.added_at DESC, e.id DESC");
        let vals: Vec<&rusqlite::types::Value> = args.iter().collect();
        let mut st = match c.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let result = match st.query_map(rusqlite::params_from_iter(vals), Self::entry_from_row) {
            Ok(it) => it.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        };
        result
    }

    pub fn entry_by_anilist(&self, anilist_id: i64, media_type: &str) -> Option<EntryView> {
        let c = self.conn();
        let sql = format!(
            "{} WHERE e.anilist_id = ?1 AND e.media_type = ?2",
            Self::ENTRY_SELECT
        );
        c.query_row(&sql, params![anilist_id, media_type], Self::entry_from_row)
            .optional()
            .ok()
            .flatten()
    }

    pub fn entries_search(&self, query: &str, media_type: &str) -> Vec<EntryView> {
        let c = self.conn();
        let pattern = format!("%{}%", query);
        let sql = format!(
            "{} WHERE e.media_type = ?1 AND (m.title_romaji LIKE ?2 OR m.title_english LIKE ?2 OR m.title_native LIKE ?2) ORDER BY m.title_romaji COLLATE NOCASE ASC",
            Self::ENTRY_SELECT
        );
        let mut st = match c.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let result = match st.query_map(params![media_type, pattern], Self::entry_from_row) {
            Ok(it) => it.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        };
        result
    }

    pub fn entry_get(&self, id: i64) -> Option<EntryView> {
        let c = self.conn();
        let sql = format!("{} WHERE e.id = ?1", Self::ENTRY_SELECT);
        c.query_row(&sql, params![id], Self::entry_from_row)
            .optional()
            .ok()
            .flatten()
    }

    pub fn entry_add(&self, anilist_id: i64, media_type: &str, status: &str) -> rusqlite::Result<i64> {
        let c = self.conn();
        c.execute(
            "INSERT OR IGNORE INTO entries (anilist_id, media_type, status)
             VALUES (?1, ?2, ?3)",
            params![anilist_id, media_type, status],
        )?;
        let id = c.query_row(
            "SELECT id FROM entries WHERE anilist_id = ?1 AND media_type = ?2",
            params![anilist_id, media_type],
            |r| r.get::<_, i64>(0),
        )?;
        Ok(id)
    }

    pub fn entry_remove(&self, id: i64) {
        let c = self.conn();
        let _ = c.execute("DELETE FROM entries WHERE id = ?1", params![id]);
    }

    /// custom_list_id: Some(-1) clears; start/finish date: Some("") clears.
    #[allow(clippy::too_many_arguments)]
    pub fn entry_update(
        &self,
        id: i64,
        status: Option<String>,
        custom_list_id: Option<i64>,
        score: Option<i64>,
        progress: Option<i64>,
        start_date: Option<String>,
        finish_date: Option<String>,
        notes: Option<String>,
        rewatches: Option<i64>,
    ) -> rusqlite::Result<()> {
        let c = self.conn();
        let prev: Option<(i64, String)> = c
            .query_row(
                "SELECT progress, media_type FROM entries WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()
            .flatten();
        let mut sql = String::from("UPDATE entries SET ");
        let mut sets: Vec<String> = Vec::new();
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        macro_rules! col {
            ($name:literal, $val:expr) => {
                if let Some(v) = $val {
                    sets.push(format!("{} = ?", $name));
                    args.push(v);
                }
            };
        }
        col!("status", status.map(|s| rusqlite::types::Value::Text(s)));
        col!("custom_list_id", custom_list_id.map(|v| {
            if v == -1 {
                rusqlite::types::Value::Null
            } else {
                rusqlite::types::Value::Integer(v)
            }
        }));
        col!("score", score.map(|s| rusqlite::types::Value::Integer(s)));
        col!("progress", progress.map(|p| rusqlite::types::Value::Integer(p)));
        col!("start_date", start_date.map(|v| {
            if v.is_empty() {
                rusqlite::types::Value::Null
            } else {
                rusqlite::types::Value::Text(v)
            }
        }));
        col!("finish_date", finish_date.map(|v| {
            if v.is_empty() {
                rusqlite::types::Value::Null
            } else {
                rusqlite::types::Value::Text(v)
            }
        }));
        col!("notes", notes.map(|n| rusqlite::types::Value::Text(n)));
        col!(
            "rewatches",
            rewatches.map(|v| rusqlite::types::Value::Integer(v.max(0)))
        );
        if sets.is_empty() {
            return Ok(());
        }
        sql.push_str(&sets.join(", "));
        sql.push_str(" WHERE id = ?");
        args.push(rusqlite::types::Value::Integer(id));
        let vals: Vec<&rusqlite::types::Value> = args.iter().collect();
        c.execute(&sql, rusqlite::params_from_iter(vals))?;
        // log positive progress deltas for the activity heatmap / streaks
        if let (Some((prev_progress, mt)), Some(new_progress)) = (prev, progress) {
            let delta = new_progress - prev_progress;
            if delta > 0 {
                let day = chrono::Utc::now()
                    .with_timezone(&chrono_tz::America::Sao_Paulo)
                    .date_naive()
                    .format("%Y-%m-%d")
                    .to_string();
                let _ = c.execute(
                    "INSERT INTO activity (day, media_type, count) VALUES (?1, ?2, ?3)
                     ON CONFLICT(day, media_type) DO UPDATE SET count = count + excluded.count",
                    params![day, mt, delta],
                );
            }
        }
        Ok(())
    }

    /// Merge one entry pulled from AniList into the local list.
    /// Returns true when a new entry was created.
    ///
    /// Remote is authoritative, with three deliberate exceptions:
    /// empty remote values never blank out local data (unrated score, empty
    /// notes, missing dates), progress/rewatches never move backwards, and
    /// activity counters are untouched — a pull is not "watching".
    pub fn entry_pull_upsert(&self, e: &PullEntry) -> rusqlite::Result<bool> {
        let c = self.conn();
        let existing: Option<(i64, Option<i64>, i64, i64, Option<String>, Option<String>, Option<String>)> = c
            .query_row(
                "SELECT score, custom_list_id, progress, rewatches, start_date, finish_date, notes
                 FROM entries WHERE anilist_id = ?1 AND media_type = ?2",
                params![e.anilist_id, e.media_type],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            local_score,
            local_custom_list,
            local_progress,
            local_rewatches,
            local_start,
            local_finish,
            local_notes,
        )) = existing
        else {
            c.execute(
                "INSERT INTO entries (anilist_id, media_type, status, custom_list_id, score,
                    progress, rewatches, start_date, finish_date, notes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    e.anilist_id,
                    e.media_type,
                    e.status,
                    e.custom_list_id,
                    e.score,
                    e.progress,
                    e.rewatches,
                    e.start_date,
                    e.finish_date,
                    e.notes.clone().unwrap_or_default(),
                ],
            )?;
            return Ok(true);
        };
        let notes = match (&e.notes, &local_notes) {
            (Some(n), _) if !n.trim().is_empty() => Some(n.clone()),
            _ => local_notes,
        };
        c.execute(
            "UPDATE entries SET status = ?1, custom_list_id = ?2, score = ?3, progress = ?4,
                rewatches = ?5, start_date = ?6, finish_date = ?7, notes = ?8
             WHERE anilist_id = ?9 AND media_type = ?10",
            params![
                e.status,
                e.custom_list_id.or(local_custom_list),
                if e.score > 0 { e.score } else { local_score },
                e.progress.max(local_progress),
                e.rewatches.max(local_rewatches),
                e.start_date.clone().or(local_start),
                e.finish_date.clone().or(local_finish),
                notes,
                e.anilist_id,
                e.media_type,
            ],
        )?;
        Ok(false)
    }

    // ---------- custom lists ----------
    pub fn custom_lists(&self) -> Vec<CustomList> {
        let c = self.conn();
        let mut st = c
            .prepare("SELECT id, media_type, name, position FROM custom_lists ORDER BY media_type, position, id")
            .unwrap();
        let rows = st
            .query_map([], |r| {
                Ok(CustomList {
                    id: r.get(0)?,
                    media_type: r.get(1)?,
                    name: r.get(2)?,
                    position: r.get(3)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn custom_list_add(&self, media_type: &str, name: &str) -> rusqlite::Result<i64> {
        let c = self.conn();
        c.execute(
            "INSERT OR IGNORE INTO custom_lists (media_type, name, position) VALUES (?1, ?2, 0)",
            params![media_type, name],
        )?;
        c.query_row(
            "SELECT id FROM custom_lists WHERE media_type = ?1 AND name = ?2",
            params![media_type, name],
            |r| r.get::<_, i64>(0),
        )
    }

    pub fn custom_list_rename(&self, id: i64, name: &str) -> rusqlite::Result<()> {
        let c = self.conn();
        c.execute(
            "UPDATE custom_lists SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    pub fn custom_list_delete(&self, id: i64) {
        let c = self.conn();
        let _ = c.execute(
            "UPDATE entries SET custom_list_id = NULL WHERE custom_list_id = ?1",
            params![id],
        );
        let _ = c.execute("DELETE FROM custom_lists WHERE id = ?1", params![id]);
    }

    pub fn custom_list_reorder(&self, ids: &[i64]) {
        let c = self.conn();
        for (i, id) in ids.iter().enumerate() {
            let _ = c.execute(
                "UPDATE custom_lists SET position = ?1 WHERE id = ?2",
                params![i as i64, id],
            );
        }
    }

    // ---------- settings ----------

    pub fn settings_all(&self) -> serde_json::Map<String, serde_json::Value> {
        let c = self.conn();
        let mut st = c.prepare("SELECT key, value FROM settings").unwrap();
        let rows = st
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .unwrap();
        let mut map = serde_json::Map::new();
        for row in rows.flatten() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&row.1) {
                map.insert(row.0, v);
            }
        }
        map
    }

    pub fn settings_get(&self, key: &str) -> Option<serde_json::Value> {
        let c = self.conn();
        c.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    }

    pub fn settings_set(&self, key: &str, value: &serde_json::Value) {
        let c = self.conn();
        let _ = c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value.to_string()],
        );
    }

    // ---------- media groups (per-anime nekoBT group prefs) ----------

    pub fn media_groups_get(&self, anilist_id: i64) -> (Vec<String>, Vec<String>) {
        let c = self.conn();
        let row = c
            .query_row(
                "SELECT include, exclude FROM media_groups WHERE anilist_id = ?1",
                params![anilist_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()
            .ok()
            .flatten();
        match row {
            Some((inc, exc)) => (
                serde_json::from_str(&inc).unwrap_or_default(),
                serde_json::from_str(&exc).unwrap_or_default(),
            ),
            None => (Vec::new(), Vec::new()),
        }
    }

    pub fn media_groups_set(&self, anilist_id: i64, include: &[String], exclude: &[String]) {
        let c = self.conn();
        let _ = c.execute(
            "INSERT INTO media_groups (anilist_id, include, exclude) VALUES (?1, ?2, ?3)
             ON CONFLICT(anilist_id) DO UPDATE SET include = excluded.include, exclude = excluded.exclude",
            params![
                anilist_id,
                serde_json::to_string(include).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(exclude).unwrap_or_else(|_| "[]".into()),
            ],
        );
    }

    pub fn search_names_get(&self, anilist_id: i64) -> Vec<String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT name FROM search_names WHERE anilist_id = ?1 ORDER BY rowid")
            .expect("prepare search_names");
        stmt.query_map(params![anilist_id], |r| r.get::<_, String>(0))
            .expect("query search_names")
            .filter_map(|x| x.ok())
            .collect()
    }

    pub fn search_names_set(&self, anilist_id: i64, names: &[String]) {
        let c = self.conn();
        let tx = match c.unchecked_transaction() {
            Ok(tx) => tx,
            Err(_) => return,
        };
        let _ = tx.execute(
            "DELETE FROM search_names WHERE anilist_id = ?1",
            params![anilist_id],
        );
        if let Ok(mut stmt) =
            tx.prepare("INSERT INTO search_names (anilist_id, name) VALUES (?1, ?2)")
        {
            for n in names {
                let n = n.trim();
                if !n.is_empty() {
                    let _ = stmt.execute(params![anilist_id, n]);
                }
            }
        }
        let _ = tx.commit();
    }

    pub fn release_filters_get(&self, anilist_id: i64) -> Vec<String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT pattern FROM release_filters WHERE anilist_id = ?1 ORDER BY rowid")
            .expect("prepare release_filters");
        stmt.query_map(params![anilist_id], |r| r.get::<_, String>(0))
            .expect("query release_filters")
            .filter_map(|x| x.ok())
            .collect()
    }

    pub fn release_filters_set(&self, anilist_id: i64, patterns: &[String]) {
        let c = self.conn();
        let tx = match c.unchecked_transaction() {
            Ok(tx) => tx,
            Err(_) => return,
        };
        let _ = tx.execute(
            "DELETE FROM release_filters WHERE anilist_id = ?1",
            params![anilist_id],
        );
        if let Ok(mut stmt) =
            tx.prepare("INSERT INTO release_filters (anilist_id, pattern) VALUES (?1, ?2)")
        {
            for p in patterns {
                let p = p.trim();
                if !p.is_empty() {
                    let _ = stmt.execute(params![anilist_id, p]);
                }
            }
        }
        let _ = tx.commit();
    }

    // ---------- quality preferences (per title) ----------

    pub fn quality_prefs_get(&self, anilist_id: i64) -> Vec<String> {
        let c = self.conn();
        let mut st = match c.prepare(
            "SELECT pattern FROM quality_prefs WHERE anilist_id = ?1 ORDER BY position, pattern",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        st.query_map(params![anilist_id], |r| r.get::<_, String>(0))
            .map(|it| it.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }

    pub fn quality_prefs_set(&self, anilist_id: i64, patterns: &[String]) {
        let c = self.conn();
        let tx = match c.unchecked_transaction() {
            Ok(tx) => tx,
            Err(_) => return,
        };
        let _ = tx.execute(
            "DELETE FROM quality_prefs WHERE anilist_id = ?1",
            params![anilist_id],
        );
        if let Ok(mut stmt) = tx.prepare(
            "INSERT OR REPLACE INTO quality_prefs (anilist_id, pattern, position) VALUES (?1, ?2, ?3)",
        ) {
            for (i, p) in patterns.iter().enumerate() {
                let p = p.trim();
                if !p.is_empty() {
                    let _ = stmt.execute(params![anilist_id, p, i as i64]);
                }
            }
        }
        let _ = tx.commit();
    }

    // ---------- activity (watch/read log) ----------

    pub fn activity_days(&self) -> Vec<serde_json::Value> {
        let c = self.conn();
        let mut st = match c.prepare("SELECT day, media_type, count FROM activity ORDER BY day") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        st.query_map([], |r| {
            Ok(serde_json::json!({
                "day": r.get::<_, String>(0)?,
                "mediaType": r.get::<_, String>(1)?,
                "count": r.get::<_, i64>(2)?,
            }))
        })
        .map(|it| it.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    // ---------- magnet queue ----------

    pub fn queue_add(
        &self,
        title: &str,
        magnet: &str,
        size: Option<&str>,
        entry_id: Option<i64>,
        episode: Option<i64>,
    ) -> i64 {
        let c = self.conn();
        let _ = c.execute(
            "INSERT INTO magnet_queue (title, magnet, size, entry_id, episode, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5,
                     (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM magnet_queue))",
            params![title, magnet, size, entry_id, episode],
        );
        c.last_insert_rowid()
    }

    pub fn queue_remove(&self, id: i64) {
        let c = self.conn();
        let _ = c.execute("DELETE FROM magnet_queue WHERE id = ?1", params![id]);
    }

    pub fn queue_clear(&self) {
        let c = self.conn();
        let _ = c.execute("DELETE FROM magnet_queue", []);
    }

    /// Applies a full ordering, `ids` being the queue from first to last.
    /// Ids not present in the table are ignored; unlisted rows are kept at the
    /// end in their previous order.
    pub fn queue_reorder(&self, ids: &[i64]) {
        let mut c = self.conn();
        let tx = match c.transaction() {
            Ok(tx) => tx,
            Err(_) => return,
        };
        // park every row out of the way so unlisted ones can't keep old ranks
        let _ = tx.execute("UPDATE magnet_queue SET sort_order = -id", []);
        for (i, id) in ids.iter().enumerate() {
            let _ = tx.execute(
                "UPDATE magnet_queue SET sort_order = ?1 WHERE id = ?2",
                params![i as i64, id],
            );
        }
        let _ = tx.execute(
            "UPDATE magnet_queue SET sort_order = ?1 + id WHERE sort_order < 0",
            params![ids.len() as i64],
        );
        let _ = tx.commit();
    }

    pub fn queue_list(&self) -> Vec<QueueItem> {
        let c = self.conn();
        let mut st = c
            .prepare(
                "SELECT id, title, magnet, size, COALESCE(added_at, 0), entry_id, episode
                 FROM magnet_queue ORDER BY COALESCE(sort_order, id), id",
            )
            .unwrap();
        let rows = st
            .query_map([], |r| {
                Ok(QueueItem {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    magnet: r.get(2)?,
                    size: r.get(3)?,
                    added_at: r.get(4)?,
                    entry_id: r.get(5)?,
                    episode: r.get(6)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    /// anilist ids + cover URLs for entries on the user's lists, used to
    /// re-populate the cover cache after it was cleared or deleted.
    pub fn covers_to_cache(&self) -> Vec<(i64, String)> {
        let c = self.conn();
        let mut st = c
            .prepare(
                "SELECT e.anilist_id, m.cover_url
                 FROM entries e JOIN media m ON m.anilist_id = e.anilist_id
                 WHERE m.cover_url IS NOT NULL AND m.cover_url != ''
                 GROUP BY e.anilist_id",
            )
            .unwrap();
        let rows = st
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    // ---------- gap report ----------

    /// Anime entries in CURRENT whose show is still RELEASING, with the latest
    /// release found for them. Used by the "gap radar" on the airing
    /// page to flag shows that stopped receiving releases.
    pub fn gap_report(&self) -> Vec<GapRow> {
        let c = self.conn();
        let mut st = c
            .prepare(
                "SELECT e.anilist_id, m.title_romaji, e.progress,
                        (SELECT MAX(episode) FROM releases r WHERE r.anilist_id = e.anilist_id),
                        (SELECT MAX(found_at) FROM releases r WHERE r.anilist_id = e.anilist_id)
                 FROM entries e JOIN media m ON m.anilist_id = e.anilist_id
                 WHERE e.media_type = 'ANIME' AND e.status = 'CURRENT'
                   AND (m.status IS NULL OR m.status = 'RELEASING')",
            )
            .unwrap();
        let rows = st
            .query_map([], |r| {
                Ok(GapRow {
                    anilist_id: r.get(0)?,
                    title: r.get(1)?,
                    progress: r.get(2)?,
                    latest_release_ep: r.get(3)?,
                    latest_release_at: r.get(4)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    // ---------- schedule ----------

    pub fn schedule_upsert(
        &self,
        anime_id: i64,
        episode: i64,
        airing_at: i64,
        title_romaji: Option<&str>,
        title_english: Option<&str>,
        title_native: Option<&str>,
        cover_url: Option<&str>,
        media_json: &serde_json::Value,
    ) {
        let c = self.conn();
        let _ = c.execute(
            "INSERT INTO schedule (anilist_id, episode, airing_at, title_romaji, title_english,
                title_native, cover_url, media_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(anilist_id, episode) DO UPDATE SET
               airing_at = excluded.airing_at, title_romaji = excluded.title_romaji,
               title_english = excluded.title_english, title_native = excluded.title_native,
               cover_url = excluded.cover_url, media_json = excluded.media_json",
            params![
                anime_id,
                episode,
                airing_at,
                title_romaji,
                title_english,
                title_native,
                cover_url,
                media_json.to_string()
            ],
        );
    }

    pub fn schedule_purge_past(&self, now: i64) {
        let c = self.conn();
        // only purge rows that were already searched, so episodes that aired
        // while the app was closed are still picked up on the next open
        let _ = c.execute(
            "DELETE FROM schedule WHERE searched = 1 AND airing_at < ?1",
            params![now - 4 * 3600],
        );
    }

    pub fn schedule_window(&self, from: i64, to: i64) -> Vec<ScheduleRow> {
        let c = self.conn();
        let mut st = c
            .prepare(
                "SELECT s.anilist_id, s.episode, s.airing_at, s.title_romaji, s.title_english, s.title_native,
                        s.cover_url, s.media_json, s.searched
                 FROM schedule s
                 WHERE s.airing_at >= ?1 AND s.airing_at <= ?2
                   AND EXISTS (SELECT 1 FROM entries e WHERE e.anilist_id = s.anilist_id)
                 ORDER BY s.airing_at",
            )
            .unwrap();
        let rows = st
            .query_map(params![from, to], |r| {
                let media_json: Option<String> = r.get(7)?;
                Ok(ScheduleRow {
                    anilist_id: r.get(0)?,
                    episode: r.get(1)?,
                    airing_at: r.get(2)?,
                    title_romaji: r.get(3)?,
                    title_english: r.get(4)?,
                    title_native: r.get(5)?,
                    cover_url: r.get(6)?,
                    media_json: media_json
                        .and_then(|s| serde_json::from_str(&s).ok()),
                    searched: r.get::<_, i64>(8)? == 1,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn schedule_pending_search(&self, now: i64) -> Vec<ScheduleRow> {
        let c = self.conn();
        let mut st = c
            .prepare(
                "SELECT s.anilist_id, s.episode, s.airing_at, s.title_romaji, s.title_english,
                        s.title_native, s.cover_url, s.media_json, s.searched
                 FROM schedule s
                 WHERE s.searched = 0 AND s.airing_at + 900 <= ?1
                   AND EXISTS (SELECT 1 FROM entries e WHERE e.anilist_id = s.anilist_id)",
            )
            .unwrap();
        let rows = st
            .query_map(params![now], |r| {
                let media_json: Option<String> = r.get(7)?;
                Ok(ScheduleRow {
                    anilist_id: r.get(0)?,
                    episode: r.get(1)?,
                    airing_at: r.get(2)?,
                    title_romaji: r.get(3)?,
                    title_english: r.get(4)?,
                    title_native: r.get(5)?,
                    cover_url: r.get(6)?,
                    media_json: media_json.and_then(|s| serde_json::from_str(&s).ok()),
                    searched: r.get::<_, i64>(8)? == 1,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn schedule_mark_searched(&self, anime_id: i64, episode: i64) {
        let c = self.conn();
        let _ = c.execute(
            "UPDATE schedule SET searched = 1 WHERE anilist_id = ?1 AND episode = ?2",
            params![anime_id, episode],
        );
    }

    pub fn schedule_mark_asked(&self, anime_id: i64, episode: i64) {
        let c = self.conn();
        let _ = c.execute(
            "UPDATE schedule SET asked = 1 WHERE anilist_id = ?1 AND episode = ?2",
            params![anime_id, episode],
        );
    }

    pub fn schedule_has_been_asked(&self, anime_id: i64, episode: i64) -> bool {
        let c = self.conn();
        c.query_row(
            "SELECT asked FROM schedule WHERE anilist_id = ?1 AND episode = ?2",
            params![anime_id, episode],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            == 1
    }

    // ---------- releases ----------

    pub fn release_insert(&self, r: &ReleaseRow) -> i64 {
        let c = self.conn();
        let _ = c.execute(
            "INSERT INTO releases (anilist_id, episode, title, url, magnet, torrent,
                size, seeders, leechers, found_at, seen)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,0)
             ON CONFLICT(anilist_id, episode, title) DO UPDATE SET
                seeders = excluded.seeders,
                leechers = excluded.leechers,
                magnet = COALESCE(excluded.magnet, releases.magnet),
                torrent = COALESCE(excluded.torrent, releases.torrent),
                found_at = excluded.found_at",
            params![
                r.anilist_id,
                r.episode,
                r.title,
                r.url,
                r.magnet,
                r.torrent,
                r.size,
                r.seeders,
                r.leechers,
                r.found_at
            ],
        );
        c.query_row(
            "SELECT id FROM releases WHERE anilist_id = ?1 AND episode = ?2 AND title = ?3",
            params![r.anilist_id, r.episode, r.title],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    }

    pub fn releases_for(&self, anilist_id: i64) -> Vec<ReleaseRow> {
        let c = self.conn();
        let mut st = c
            .prepare(
                "SELECT id, anilist_id, episode, title, url, magnet, torrent, size,
                        seeders, leechers, found_at, seen
                 FROM releases WHERE anilist_id = ?1 ORDER BY episode DESC, found_at DESC",
            )
            .unwrap();
        let rows = st
            .query_map(params![anilist_id], |r| {
                Ok(ReleaseRow {
                    id: r.get(0)?,
                    anilist_id: r.get(1)?,
                    episode: r.get(2)?,
                    title: r.get(3)?,
                    url: r.get(4)?,
                    magnet: r.get(5)?,
                    torrent: r.get(6)?,
                    size: r.get(7)?,
                    seeders: r.get(8)?,
                    leechers: r.get(9)?,
                    found_at: r.get(10)?,
                    seen: r.get(11)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn releases_clear(&self, anilist_id: i64) {
        let c = self.conn();
        let _ = c.execute(
            "DELETE FROM releases WHERE anilist_id = ?1",
            params![anilist_id],
        );
    }

    pub fn release_mark_seen(&self, id: i64) {
        let c = self.conn();
        let _ = c.execute("UPDATE releases SET seen = 1 WHERE id = ?1", params![id]);
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    pub id: i64,
    pub anilist_id: i64,
    pub media_type: String,
    pub status: String,
    pub custom_list_id: Option<i64>,
    pub score: i64,
    pub progress: i64,
    pub rewatches: i64,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub notes: String,
    pub added_at: i64,
    pub title: Option<String>,
    pub title_english: Option<String>,
    pub title_native: Option<String>,
    pub format: Option<String>,
    pub media_status: Option<String>,
    pub episodes: Option<i64>,
    pub chapters: Option<i64>,
    pub volumes: Option<i64>,
    pub cover_url: Option<String>,
    pub cover_file: Option<String>,
    pub average_score: Option<i64>,
    pub genres: Option<String>,
    pub season: Option<String>,
    pub season_year: Option<i64>,
    pub total: Option<i64>,
    pub duration: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: i64,
    pub title: String,
    pub magnet: String,
    pub size: Option<String>,
    pub added_at: i64,
    pub entry_id: Option<i64>,
    pub episode: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GapRow {
    pub anilist_id: i64,
    pub title: Option<String>,
    pub progress: i64,
    pub latest_release_ep: Option<i64>,
    pub latest_release_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct MediaRow {
    pub anilist_id: i64,
    pub mal_id: Option<i64>,
    pub media_type: String,
    pub title_romaji: Option<String>,
    pub title_english: Option<String>,
    pub title_native: Option<String>,
    pub format: Option<String>,
    pub status: Option<String>,
    pub episodes: Option<i64>,
    pub chapters: Option<i64>,
    pub volumes: Option<i64>,
    pub cover_url: Option<String>,
    pub description: Option<String>,
    pub average_score: Option<i64>,
    pub genres: Option<String>,
    pub studios: Option<String>,
    pub season: Option<String>,
    pub season_year: Option<i64>,
    pub duration: Option<i64>,
}

impl MediaRow {
    pub fn from_json(v: &serde_json::Value) -> MediaRow {
        let g = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string());
        let i = |k: &str| v.get(k).and_then(|x| x.as_i64());
        let title = v.get("title").cloned().unwrap_or(serde_json::Value::Null);
        let t = |k: &str| {
            title
                .get(k)
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        };
        let cover = v
            .get("coverImage")
            .and_then(|c| c.get("large"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let genres: Option<String> = v
            .get("genres")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            });
        let studios: Option<String> = v
            .get("studios")
            .and_then(|s| s.get("nodes"))
            .and_then(|n| n.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.get("name").and_then(|n| n.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ")
            });
        MediaRow {
            anilist_id: v.get("id").and_then(|x| x.as_i64()).unwrap_or(0),
            mal_id: v.get("idMal").and_then(|x| x.as_i64()),
            media_type: g("type").unwrap_or_default(),
            title_romaji: t("romaji"),
            title_english: t("english"),
            title_native: t("native"),
            format: g("format"),
            status: g("status"),
            episodes: i("episodes"),
            chapters: i("chapters"),
            volumes: i("volumes"),
            cover_url: cover,
            description: g("description"),
            average_score: i("averageScore"),
            genres,
            studios,
            season: g("season"),
            season_year: i("seasonYear"),
            duration: i("duration"),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomList {
    pub id: i64,
    pub media_type: String,
    pub name: String,
    pub position: i64,
}

#[derive(Clone, Debug)]
pub struct PullEntry {
    pub anilist_id: i64,
    pub media_type: String,
    pub status: String,
    pub custom_list_id: Option<i64>,
    pub score: i64,
    pub progress: i64,
    pub rewatches: i64,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRow {
    pub id: i64,
    pub anilist_id: i64,
    pub episode: i64,
    pub title: String,
    pub url: Option<String>,
    pub magnet: Option<String>,
    pub torrent: Option<String>,
    pub size: Option<String>,
    pub seeders: i64,
    pub leechers: i64,
    pub found_at: Option<i64>,
    pub seen: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRow {
    pub anilist_id: i64,
    pub episode: i64,
    pub airing_at: i64,
    pub title_romaji: Option<String>,
    pub title_english: Option<String>,
    pub title_native: Option<String>,
    pub cover_url: Option<String>,
    pub media_json: Option<serde_json::Value>,
    pub searched: bool,
}