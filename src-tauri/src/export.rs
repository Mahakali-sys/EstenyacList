use crate::anilist::AniList;
use crate::db::{Db, MediaRow};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size: i64,
    pub modified: i64,
}

fn backup_prefix() -> String {
    "estenyac_backup_".to_string()
}

// Writes a rolling monthly MAL-format backup next to the database. With
// `force` the current month's file is refreshed. Older months are pruned
// so only the latest KEEP_BACKUPS files remain.
const KEEP_BACKUPS: usize = 6;

pub fn write_backup(db: &Db, force: bool) -> Result<String, String> {
    let dir = crate::db::exe_dir();
    let _ = std::fs::create_dir_all(&dir);
    let month = chrono::Utc::now().format("%Y%m").to_string();
    let path = dir.join(format!("{}{}.xml", backup_prefix(), month));
    if path.exists() && !force {
        return Ok(path.to_string_lossy().to_string());
    }
    let xml = build_export_xml(db)?;
    std::fs::write(&path, xml).map_err(|e| format!("backup write failed: {e}"))?;
    prune_old_backups(&dir);
    Ok(path.to_string_lossy().to_string())
}

fn prune_old_backups(dir: &std::path::Path) {
    // keep only the newest KEEP_BACKUPS backup files
    let mut files: Vec<(std::path::PathBuf, std::time::SystemTime)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with(backup_prefix().as_str()) && n.ends_with(".xml"))
                .unwrap_or(false)
        })
        .filter_map(|e| {
            let modified = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((e.path(), modified))
        })
        .collect();
    if files.len() <= KEEP_BACKUPS {
        return;
    }
    files.sort_by_key(|(_, m)| *m);
    let excess = files.len() - KEEP_BACKUPS;
    for (path, _) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

pub fn backup_files() -> Vec<BackupInfo> {
    let dir = crate::db::exe_dir();
    let mut out: Vec<BackupInfo> = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            if !name.starts_with(backup_prefix().as_str()) || !name.ends_with(".xml") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs() as i64;
            Some(BackupInfo {
                name,
                path: e.path().to_string_lossy().to_string(),
                size: meta.len() as i64,
                modified,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

pub fn latest_backup() -> Option<BackupInfo> {
    backup_files().into_iter().next()
}

fn mal_status(status: &str, manga: bool) -> String {
    match status {
        "CURRENT" => if manga { "Reading" } else { "Watching" }.to_string(),
        "COMPLETED" => "Completed".to_string(),
        "PAUSED" => "On-Hold".to_string(),
        "DROPPED" => "Dropped".to_string(),
        "PLANNING" => if manga { "Plan to Read" } else { "Plan to Watch" }.to_string(),
        _ => if manga { "Reading" } else { "Watching" }.to_string(),
    }
}

fn mal_date(d: &Option<String>) -> String {
    match d {
        Some(s) if !s.is_empty() && !s.starts_with("0000") => s.clone(),
        _ => "0000-00-00".to_string(),
    }
}

pub fn section_only(xml: &str, section: &str) -> Option<String> {
    let open = format!("    <{section}>\n");
    let close = format!("    </{section}>\n");
    let start = xml.find(&open)?;
    let end = xml[start..].find(&close)? + start + close.len();
    let body = &xml[start..end];
    Some(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<myanimelist>\n{body}\n</myanimelist>\n"
    ))
}

pub fn build_export_xml(db: &Db) -> Result<String, String> {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<myanimelist>\n    <myinfo>\n        <user_id></user_id>\n        <user_name>EstenyacList</user_name>\n        <user_export_type>1</user_export_type>\n        <user_total_anime>0</user_total_anime>\n        <user_total_watching>0</user_total_watching>\n        <user_total_completed>0</user_total_completed>\n        <user_total_onhold>0</user_total_onhold>\n        <user_total_dropped>0</user_total_dropped>\n        <user_total_plantowatch>0</user_total_plantowatch>\n    </myinfo>\n",
    );
    for (manga, tag) in [(false, "anime"), (true, "manga")] {
        let entries = db.entries_get(Some(if manga { "MANGA" } else { "ANIME" }), None, None);
        for e in &entries {
            let total = if manga {
                e.chapters.unwrap_or(0)
            } else {
                e.episodes.unwrap_or(0)
            };
            let progress_tag = if manga {
                "my_read_chapters"
            } else {
                "my_watched_episodes"
            };
            let volumes = e.volumes.unwrap_or(0);
            let mal_id = db
                .media_get(e.anilist_id)
                .and_then(|m| m.get("malId").and_then(|x| x.as_i64()))
                .unwrap_or(0);
            if mal_id == 0 {
                continue;
            }
            out.push_str("    <");
            out.push_str(tag);
            out.push_str(">\n");
            out.push_str(&format!(
                "        <series_animedb_id>{mal_id}</series_animedb_id>\n"
            ));
            out.push_str(&format!(
                "        <series_title><![CDATA[{}]]></series_title>\n",
                e.title.clone().unwrap_or_default().replace("]]>", "]]]]><![CDATA[>")
            ));
            out.push_str(&format!(
                "        <series_type>{}</series_type>\n",
                e.format.as_deref().unwrap_or_default()
            ));
            out.push_str(&format!("        <series_episodes>{total}</series_episodes>\n"));
            out.push_str(&format!(
                "        <series_chapters>{}</series_chapters>\n",
                e.chapters.unwrap_or(0)
            ));
            out.push_str(&format!("        <series_volumes>{volumes}</series_volumes>\n"));
            out.push_str("        <my_id>0</my_id>\n");
            out.push_str(&format!("        <{progress_tag}>{}</{progress_tag}>\n", e.progress));
            out.push_str(&format!("        <my_start_date>{}</my_start_date>\n", mal_date(&e.start_date)));
            out.push_str(&format!("        <my_finish_date>{}</my_finish_date>\n", mal_date(&e.finish_date)));
            out.push_str("        <my_rated></my_rated>\n");
            out.push_str(&format!("        <my_score>{}</my_score>\n", e.score));
            out.push_str("        <my_dvd></my_dvd>\n");
            out.push_str(&format!("        <my_status>{}</my_status>\n", mal_status(&e.status, manga)));
            out.push_str(&format!(
                "        <my_comments><![CDATA[{}]]></my_comments>\n",
                e.notes.replace("]]>", "]]]]><![CDATA[>")
            ));
            out.push_str("        <my_times_watched>0</my_times_watched>\n");
            out.push_str("        <my_rewatch_value></my_rewatch_value>\n");
            out.push_str("        <my_tags><![CDATA[]]></my_tags>\n");
            out.push_str("        <my_rewatching>0</my_rewatching>\n");
            out.push_str("        <my_rewatching_ep>0</my_rewatching_ep>\n");
            out.push_str("        <update_on_import>0</update_on_import>\n");
            out.push_str("    </");
            out.push_str(tag);
            out.push_str(">\n");
        }
    }
    out.push_str("</myanimelist>\n");
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub mal_id: i64,
    pub title: String,
    pub media_type: String,
    pub progress: i64,
    pub score: i64,
    pub status: String,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: usize,
    pub skipped: usize,
    pub failed: usize,
    pub not_found: Vec<String>,
}

pub fn parse_mal_xml(xml: &str) -> Result<Vec<ImportItem>, String> {
    let mut items = Vec::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut in_anime = false;
    let mut in_manga = false;
    let mut cur: Option<ImportItem> = None;
    let mut cur_field = String::new();
    let mut cur_text = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "anime" => {
                        in_anime = true;
                        in_manga = false;
                        cur = Some(ImportItem {
                            mal_id: 0,
                            title: String::new(),
                            media_type: "ANIME".into(),
                            progress: 0,
                            score: 0,
                            status: "PLANNING".into(),
                            start_date: None,
                            finish_date: None,
                            notes: None,
                        });
                    }
                    "manga" => {
                        in_manga = true;
                        in_anime = false;
                        cur = Some(ImportItem {
                            mal_id: 0,
                            title: String::new(),
                            media_type: "MANGA".into(),
                            progress: 0,
                            score: 0,
                            status: "PLANNING".into(),
                            start_date: None,
                            finish_date: None,
                            notes: None,
                        });
                    }
                    _ => {
                        if cur.is_some() {
                            cur_field = name;
                            cur_text.clear();
                        }
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if cur.is_some() {
                    if let Ok(s) = t.unescape() {
                        cur_text.push_str(&s);
                    }
                }
            }
            Ok(Event::CData(t)) => {
                if cur.is_some() {
                    cur_text.push_str(&String::from_utf8_lossy(&t));
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "anime" || name == "manga" {
                    if let Some(item) = cur.take() {
                        if item.mal_id > 0 {
                            items.push(item);
                        }
                    }
                    in_anime = false;
                    in_manga = false;
                    cur_field.clear();
                } else if let Some(item) = cur.as_mut() {
                    let val = cur_text.trim().to_string();
                    match cur_field.as_str() {
                        "series_animedb_id" => item.mal_id = val.parse().unwrap_or(0),
                        "series_title" => item.title = val,
                        "my_watched_episodes" => item.progress = val.parse().unwrap_or(0),
                        "my_read_chapters" => item.progress = val.parse().unwrap_or(0),
                        "my_score" => item.score = val.parse().unwrap_or(0).clamp(0, 10),
                        "my_status" => {
                            item.status = match val.as_str() {
                                "Watching" | "Reading" => "CURRENT",
                                "Completed" => "COMPLETED",
                                "On-Hold" => "PAUSED",
                                "Dropped" => "DROPPED",
                                "Plan to Watch" | "Plan to Read" => "PLANNING",
                                _ => "PLANNING",
                            }
                            .into();
                        }
                        "my_start_date" => {
                            if !val.is_empty() && !val.starts_with("0000") {
                                item.start_date = Some(val);
                            }
                        }
                        "my_finish_date" => {
                            if !val.is_empty() && !val.starts_with("0000") {
                                item.finish_date = Some(val);
                            }
                        }
                        "my_comments" => item.notes = Some(val),
                        _ => {}
                    }
                    if name == "series_title" {
                        // keep
                    }
                    cur_field.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }
    let _ = in_anime;
    let _ = in_manga;
    Ok(items)
}

/// Processes import items: resolves AniList ids (rate-limited) and writes entries.
pub async fn import_items(
    db: &Db,
    anilist: &Arc<AniList>,
    items: Vec<ImportItem>,
    on_progress: impl Fn(usize, usize, &str) + Send + Sync,
) -> ImportReport {
    let mut report = ImportReport { added: 0, skipped: 0, failed: 0, not_found: Vec::new() };
    let total = items.len();
    for (i, item) in items.into_iter().enumerate() {
        let row = match anilist.media_by_idmal(item.mal_id, &item.media_type).await {
            Ok(v) if !v.is_null() => MediaRow::from_json(&v),
            _ => {
                on_progress(i + 1, total, &item.title);
                report.failed += 1;
                report.not_found.push(format!("{} (MAL {})", item.title, item.mal_id));
                continue;
            }
        };
        if row.media_type != item.media_type {
            on_progress(i + 1, total, &item.title);
            report.failed += 1;
            report.not_found.push(format!(
                "{} (MAL {}) resolved to {}",
                item.title, item.mal_id, row.media_type
            ));
            continue;
        }
        let anime_id = row.anilist_id;
        on_progress(i + 1, total, &item.title);
        // store/refresh media metadata (idmal response already carries full fields)
        let _ = db.media_upsert(&row);
        if let Some(mal) = row.mal_id {
            db.media_set_mal_id(anime_id, mal);
        }
        if db.entry_by_anilist(anime_id, &item.media_type).is_some() {
            report.skipped += 1;
            continue;
        }
        let id = db.entry_add(anime_id, &item.media_type, &item.status);
        if let Ok(id) = id {
            let _ = db.entry_update(
                id,
                None,
                None,
                Some(item.score),
                Some(item.progress),
                item.start_date.clone(),
                item.finish_date.clone(),
                Some(item.notes.clone().unwrap_or_default()),
                None,
            );
            report.added += 1;
            // fetch cover for cache (list entries only; polite resolution)
            let cover = db
                .media_get(anime_id)
                .and_then(|m| m.get("coverUrl").and_then(|c| c.as_str().map(|s| s.to_string())));
            crate::images::ensure_cover(db, anime_id, cover.as_deref()).await;
        } else {
            report.failed += 1;
        }
    }
    report
}