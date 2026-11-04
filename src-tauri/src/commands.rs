use crate::db::{CustomList, EntryView, GapRow, MediaRow, QueueItem, ReleaseRow, ScheduleRow};
use crate::scheduler::AppState;
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub fn fmt_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub type S<'r> = State<'r, Arc<AppState>>;

// ---------- DB & lists ----------

#[tauri::command]
pub fn get_db_path() -> String {
    crate::db::db_path().to_string_lossy().to_string()
}

#[tauri::command]
pub fn get_entry(state: S<'_>, id: i64) -> Result<EntryView, String> {
    state
        .inner()
        .db
        .entry_get(id)
        .ok_or_else(|| "entry not found".into())
}

#[tauri::command]
pub fn get_entries(
    state: S<'_>,
    media_type: Option<String>,
    status: Option<String>,
    custom_list_id: Option<i64>,
) -> Vec<EntryView> {
    // normalize sentinel values sent from the frontend
    let status = status.filter(|s| !s.is_empty());
    let custom_list_id = custom_list_id.filter(|&c| c >= 0);
    state
        .inner()
        .db
        .entries_get(media_type.as_deref(), status.as_deref(), custom_list_id)
}

#[tauri::command]
pub async fn add_entry(
    state: S<'_>,
    anilist_id: i64,
    media_type: String,
    status: String,
) -> Result<EntryView, String> {
    let db = state.inner().db.clone();
    let anilist = state.inner().anilist.clone();
    if !["ANIME", "MANGA"].contains(&media_type.as_str()) {
        return Err("media_type must be ANIME or MANGA".into());
    }
    // fetch & store metadata (rate limited)
    let media_json = anilist.media_by_id(anilist_id).await?;
    if media_json.is_null() {
        return Err("media not found on AniList".into());
    }
    let row = MediaRow::from_json(&media_json);
    db.media_upsert(&row).map_err(fmt_err)?;
    let id = db
        .entry_add(anilist_id, &media_type, &status)
        .map_err(fmt_err)?;
    // download cover for cache (only list entries, medium resolution)
    let cover = media_json
        .get("coverImage")
        .and_then(|c| c.get("large"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());
    crate::images::ensure_cover(&db, anilist_id, cover.as_deref()).await;
    db.entry_get(id).ok_or_else(|| "entry missing after add".into())
}

#[tauri::command]
pub fn remove_entry(state: S<'_>, id: i64) {
    state.inner().db.entry_remove(id);
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_entry(
    state: S<'_>,
    id: i64,
    status: Option<String>,
    custom_list_id: Option<i64>,
    score: Option<i64>,
    progress: Option<i64>,
    start_date: Option<String>,
    finish_date: Option<String>,
    notes: Option<String>,
    rewatches: Option<i64>,
) -> Result<EntryView, String> {
    if let Some(cid) = custom_list_id {
        if cid != -1 {
            let exists = state
                .inner()
                .db
                .custom_lists()
                .iter()
                .any(|l| l.id == cid);
            if !exists {
                return Err("custom list not found".into());
            }
        }
    }
    state
        .inner()
        .db
        .entry_update(
            id,
            status,
            custom_list_id,
            score,
            progress,
            start_date,
            finish_date,
            notes,
            rewatches,
        )
        .map_err(fmt_err)?;
    state
        .inner()
        .db
        .entry_get(id)
        .ok_or_else(|| "entry not found".into())
}

#[tauri::command]
pub fn get_custom_lists(state: S<'_>) -> Vec<CustomList> {
    state.inner().db.custom_lists()
}

#[tauri::command]
pub fn create_custom_list(
    state: S<'_>,
    media_type: String,
    name: String,
) -> Result<i64, String> {
    if name.trim().is_empty() {
        return Err("name cannot be empty".into());
    }
    state
        .inner()
        .db
        .custom_list_add(&media_type, name.trim())
        .map_err(fmt_err)
}

#[tauri::command]
pub fn rename_custom_list(state: S<'_>, id: i64, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("name cannot be empty".into());
    }
    state
        .inner()
        .db
        .custom_list_rename(id, name.trim())
        .map_err(fmt_err)
}

#[tauri::command]
pub fn delete_custom_list(state: S<'_>, id: i64) {
    state.inner().db.custom_list_delete(id);
}

#[tauri::command]
pub fn reorder_custom_lists(state: S<'_>, ids: Vec<i64>) {
    state.inner().db.custom_list_reorder(&ids);
}

#[tauri::command]
pub fn get_activity(state: S<'_>) -> Vec<serde_json::Value> {
    state.inner().db.activity_days()
}

// ---------- AniList ----------

#[tauri::command]
pub async fn search_anilist(
    state: S<'_>,
    query: String,
    media_type: String,
) -> Result<Vec<crate::anilist::MediaSummary>, String> {
    let anilist = state.inner().anilist.clone();
    let db = state.inner().db.clone();
    let media_type = media_type.to_uppercase();
    let mut results = anilist.search(query.trim(), &media_type).await?;
    for m in &mut results {
        m.in_list = db
            .entry_by_anilist(m.id, &media_type)
            .map(|e| e.status);
    }
    Ok(results)
}

#[tauri::command]
pub fn search_entries(
    state: S<'_>,
    query: String,
    media_type: String,
) -> Vec<EntryView> {
    state
        .inner()
        .db
        .entries_search(query.trim(), &media_type.to_uppercase())
}

#[tauri::command]
pub async fn get_media(
    state: S<'_>,
    anilist_id: i64,
) -> Result<serde_json::Value, String> {
    let anilist = state.inner().anilist.clone();
    anilist.media_by_id(anilist_id).await
}

// ---------- schedule ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleView {
    #[serde(flatten)]
    pub row: ScheduleRow,
    pub in_list: bool,
    pub entry_id: Option<i64>,
    pub entry_status: Option<String>,
    pub entry_progress: Option<i64>,
    pub releases: Vec<ReleaseRow>,
}

#[tauri::command]
pub fn schedule_next_week(state: S<'_>) -> Vec<ScheduleView> {
    let db = state.inner().db.clone();
    let now = chrono::Utc::now().timestamp();
    let to = now + 7 * 24 * 3600;
    let rows = db.schedule_window(now, to);
    let mut out = Vec::new();
    for row in rows {
        let entry = db.entry_by_anilist(row.anilist_id, "ANIME");
        let releases = if entry.is_some() {
            db.releases_for(row.anilist_id)
        } else {
            Vec::new()
        };
        out.push(ScheduleView {
            in_list: entry.is_some(),
            entry_id: entry.as_ref().map(|e| e.id),
            entry_status: entry.as_ref().map(|e| e.status.clone()),
            entry_progress: entry.as_ref().map(|e| e.progress),
            releases,
            row,
        });
    }
    out
}

#[tauri::command]
pub fn schedule_status(state: S<'_>) -> serde_json::Value {
    let db = state.inner().db.clone();
    let now = chrono::Utc::now().timestamp();
    let count = db.schedule_window(now - 86400, now + 7 * 86400).len();
    let last = db
        .settings_get("last_schedule_sync")
        .and_then(|v| v.as_i64());
    let state = state.inner();
    json!({
        "count": count,
        "lastSync": last,
        "syncing": state.syncing.load(std::sync::atomic::Ordering::SeqCst),
        "searching": state.searching.load(std::sync::atomic::Ordering::SeqCst),
    })
}

#[tauri::command]
pub async fn resync_schedule(state: S<'_>) -> Result<usize, String> {
    let app_state = state.inner().clone();
    let started = app_state
        .syncing
        .compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
        .is_ok();
    if !started {
        return Err("already syncing".into());
    }
    let result = crate::scheduler::sync_schedule(app_state.clone()).await;
    app_state.syncing.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}

// ---------- images ----------

#[tauri::command]
pub fn image_data(_state: S<'_>, anilist_id: i64) -> Option<String> {
    crate::images::image_data(anilist_id)
}

#[tauri::command]
pub fn clear_image_cache(state: S<'_>) -> Result<(), String> {
    crate::images::delete_cache().map_err(fmt_err)?;
    state.inner().db.media_clear_covers();
    Ok(())
}

/// Re-downloads covers for every list entry and re-encodes them into the
/// local JPEG XL cache. Emits "covers-progress" events along the way.
#[tauri::command]
pub async fn redownload_covers(app: AppHandle, state: S<'_>) -> Result<usize, String> {
    let db = state.inner().db.clone();
    let app2 = app.clone();
    let done = cache_missing_covers(db, Some(&app2)).await;
    Ok(done)
}

/// Ensures every list entry has a cached cover. Skips entries whose file
/// already exists. Pass an app handle to emit "covers-progress" events.
async fn cache_missing_covers(db: Arc<crate::db::Db>, app: Option<&AppHandle>) -> usize {
    let jobs = db.covers_to_cache();
    let total = jobs.len();
    let Some(client) = crate::images::http_client() else {
        return 0;
    };
    let mut done = 0usize;
    for (i, (anilist_id, url)) in jobs.into_iter().enumerate() {
        if crate::images::file_for(anilist_id).exists() {
            done += 1;
        } else if let Some(bytes) = crate::images::fetch_bytes(client, &url).await {
            if crate::images::store_cover_bytes(&db, anilist_id, &bytes).is_some() {
                done += 1;
            }
        }
        if let Some(app) = app {
            app.emit(
                "covers-progress",
                json!({ "processed": i + 1, "total": total }),
            )
            .ok();
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    done
}

// ---------- watch queue ----------

#[tauri::command]
pub fn queue_list(state: S<'_>) -> Vec<QueueItem> {
    state.inner().db.queue_list()
}

#[tauri::command]
pub fn queue_add(
    state: S<'_>,
    title: String,
    magnet: String,
    size: Option<String>,
    entry_id: Option<i64>,
    episode: Option<i64>,
) -> i64 {
    state.inner().db.queue_add(
        title.trim(),
        magnet.trim(),
        size.as_deref(),
        entry_id,
        episode,
    )
}

#[tauri::command]
pub fn queue_remove(state: S<'_>, id: i64) {
    state.inner().db.queue_remove(id);
}

#[tauri::command]
pub fn queue_clear(state: S<'_>) {
    state.inner().db.queue_clear();
}

#[tauri::command]
pub fn queue_reorder(state: S<'_>, ids: Vec<i64>) {
    state.inner().db.queue_reorder(&ids);
}

// ---------- gap radar ----------

#[tauri::command]
pub fn gap_report(state: S<'_>) -> Vec<GapRow> {
    state.inner().db.gap_report()
}

// ---------- backups ----------

#[tauri::command]
pub fn run_backup(state: S<'_>, force: Option<bool>) -> Result<String, String> {
    crate::export::write_backup(&state.inner().db, force.unwrap_or(false))
}

#[tauri::command]
pub fn list_backups() -> Vec<crate::export::BackupInfo> {
    crate::export::backup_files()
}

/// Restores a MAL-format XML backup. Without a name, the latest backup is
/// used; pass a backup's file name to restore that specific one.
#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    state: S<'_>,
    name: Option<String>,
) -> Result<crate::export::ImportReport, String> {
    let backup = match name.as_deref() {
        Some(n) => crate::export::backup_files()
            .into_iter()
            .find(|b| b.name == n)
            .ok_or_else(|| format!("backup \"{n}\" not found next to the database"))?,
        None => crate::export::latest_backup()
            .ok_or("no backup files found next to the database")?,
    };
    let xml = std::fs::read_to_string(&backup.path)
        .map_err(|e| format!("cannot read {}: {e}", backup.name))?;
    let items = crate::export::parse_mal_xml(&xml)?;
    let db = state.inner().db.clone();
    let anilist = state.inner().anilist.clone();
    let report = crate::export::import_items(&db, &anilist, items, |processed, total, current| {
        app.emit(
            "import-progress",
            json!({ "processed": processed, "total": total, "current": current }),
        )
        .ok();
    })
    .await;
    Ok(report)
}

// ---------- releases / nyaa ----------

#[tauri::command]
pub fn get_releases(state: S<'_>, anilist_id: i64) -> Vec<ReleaseRow> {
    state.inner().db.releases_for(anilist_id)
}

#[tauri::command]
pub fn mark_release_seen(state: S<'_>, id: i64) {
    state.inner().db.release_mark_seen(id);
}

#[tauri::command]
pub fn clear_releases(state: S<'_>, anilist_id: i64) {
    state.inner().db.releases_clear(anilist_id);
}

#[tauri::command]
pub async fn search_releases_now(
    app: AppHandle,
    state: S<'_>,
    anilist_id: i64,
    episode: i64,
) -> Result<usize, String> {
    let app_state = state.inner().clone();
    let db = app_state.db.clone();
    let nyaa = app_state.nyaa.clone();
    let neko = app_state.neko.clone();
    let now = chrono::Utc::now().timestamp();
    let row = db
        .schedule_window(now - 86400 * 7, now + 86400 * 7)
        .into_iter()
        .find(|r| r.anilist_id == anilist_id && r.episode == episode)
        .or_else(|| schedule_row_synthetic(&db, anilist_id, episode))
        .ok_or_else(|| "media not in database; sync schedule first".to_string())?;
    let filters = db
        .settings_get("nyaa_filters")
        .map(|v| {
            serde_json::from_value::<crate::nyaa::NyaaFilters>(v)
                .unwrap_or_else(|_| crate::nyaa::NyaaFilters::default_filters())
        })
        .unwrap_or_else(crate::nyaa::NyaaFilters::default_filters);
    let neko_base = db
        .settings_get("neko_base")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "https://nekobt.to".to_string());
    let neko_key = db
        .settings_get("neko_key")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    neko.set_base(neko_base);
    neko.set_key(neko_key);
    let neko_filters = db
        .settings_get("neko_filters")
        .map(|v| {
            serde_json::from_value::<crate::neko::NekoFilters>(v)
                .unwrap_or_else(|_| crate::neko::NekoFilters::default_filters())
        })
        .unwrap_or_else(crate::neko::NekoFilters::default_filters);
    let tracker = db
        .settings_get("tracker")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "auto".to_string());
    crate::releases::search_for_schedule_item(
        &app,
        &db,
        &nyaa,
        &neko,
        &row,
        &filters,
        &neko_filters,
        &tracker,
        false,
    )
    .await
}

fn schedule_row_synthetic(db: &Arc<crate::db::Db>, anilist_id: i64, episode: i64) -> Option<ScheduleRow> {
    let media = db.media_get(anilist_id)?;
    Some(ScheduleRow {
        anilist_id,
        episode,
        airing_at: chrono::Utc::now().timestamp(),
        title_romaji: media
            .get("titleRomaji")
            .and_then(|t| t.as_str().map(|s| s.to_string())),
        title_english: media
            .get("titleEnglish")
            .and_then(|t| t.as_str().map(|s| s.to_string())),
        title_native: media
            .get("titleNative")
            .and_then(|t| t.as_str().map(|s| s.to_string())),
        cover_url: media
            .get("coverUrl")
            .and_then(|c| c.as_str().map(|s| s.to_string())),
        media_json: Some(media),
        searched: false,
    })
}

#[tauri::command]
pub async fn nyaa_test(
    state: S<'_>,
    query: String,
) -> Result<Vec<crate::nyaa::NyaaResult>, String> {
    state
        .inner()
        .nyaa
        .search(query.trim())
        .await
}

// ---------- nekoBT ----------

fn load_neko(state: &AppState) -> Arc<crate::neko::Neko> {
    let neko = state.neko.clone();
    let base = state
        .db
        .settings_get("neko_base")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "https://nekobt.to".to_string());
    let key = state
        .db
        .settings_get("neko_key")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    neko.set_base(base);
    neko.set_key(key);
    neko
}

#[tauri::command]
pub async fn neko_test(
    state: S<'_>,
    query: String,
) -> Result<Vec<crate::neko::NekoTorrent>, String> {
    let neko = load_neko(state.inner());
    neko.search_torrents(&[
        ("query".into(), query.trim().to_string()),
        ("sort_by".into(), "seeders".into()),
        ("limit".into(), "20".into()),
    ])
    .await
}

#[tauri::command]
pub async fn neko_search_groups(
    state: S<'_>,
    query: String,
) -> Result<Vec<crate::neko::NekoGroup>, String> {
    let neko = load_neko(state.inner());
    neko.search_groups(&query, 20).await
}

#[tauri::command]
pub fn get_media_groups(state: S<'_>, anilist_id: i64) -> (Vec<String>, Vec<String>) {
    state.inner().db.media_groups_get(anilist_id)
}

#[tauri::command]
pub fn set_media_groups(
    state: S<'_>,
    anilist_id: i64,
    include: Vec<String>,
    exclude: Vec<String>,
) {
    state.inner().db.media_groups_set(anilist_id, &include, &exclude);
}

#[tauri::command]
pub fn get_search_names(state: S<'_>, anilist_id: i64) -> Vec<String> {
    state.inner().db.search_names_get(anilist_id)
}

#[tauri::command]
pub fn set_search_names(state: S<'_>, anilist_id: i64, names: Vec<String>) {
    state.inner().db.search_names_set(anilist_id, &names);
}

#[tauri::command]
pub fn get_release_filters(state: S<'_>, anilist_id: i64) -> Vec<String> {
    state.inner().db.release_filters_get(anilist_id)
}

#[tauri::command]
pub fn set_release_filters(state: S<'_>, anilist_id: i64, patterns: Vec<String>) {
    state.inner().db.release_filters_set(anilist_id, &patterns);
}

#[tauri::command]
pub fn get_quality_prefs(state: S<'_>, anilist_id: i64) -> Vec<String> {
    state.inner().db.quality_prefs_get(anilist_id)
}

#[tauri::command]
pub fn set_quality_prefs(state: S<'_>, anilist_id: i64, patterns: Vec<String>) {
    state.inner().db.quality_prefs_set(anilist_id, &patterns);
}

// ---------- mpv ----------

#[tauri::command]
pub fn check_mpv(state: S<'_>) -> Result<String, String> {
    let mpv_path = state
        .inner()
        .db
        .settings_get("mpv_path")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    crate::mpv::verify_mpv(&mpv_path)
}

// ---------- settings ----------

#[tauri::command]
pub fn get_settings(state: S<'_>) -> serde_json::Value {
    let mut map = state.inner().db.settings_all();
    map.remove("anilist_token");
    serde_json::Value::Object(map)
}

#[tauri::command]
pub fn set_settings(state: S<'_>, key: String, value: serde_json::Value) {
    state.inner().db.settings_set(&key, &value);
}

// ---------- anilist account sync ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AniListAccount {
    pub username: String,
    pub score_format: String,
}

fn setting_str(state: &AppState, key: &str) -> String {
    state
        .db
        .settings_get(key)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open browser: {e}"))
}

#[tauri::command]
pub fn open_anilist_auth(client_id: String) -> Result<(), String> {
    let id = client_id.trim();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("enter the numeric client id first".into());
    }
    let url = format!(
        "https://anilist.co/api/v2/oauth/authorize?client_id={id}&redirect_uri=https%3A%2F%2Fanilist.co%2Fapi%2Fv2%2Foauth%2Fpin&response_type=code"
    );
    open_browser(&url)
}

#[tauri::command]
pub fn open_anilist_developer() -> Result<(), String> {
    open_browser("https://anilist.co/settings/developer")
}

#[tauri::command]
pub async fn anilist_connect(
    state: S<'_>,
    client_id: String,
    client_secret: String,
    code: String,
) -> Result<AniListAccount, String> {
    let client_id = client_id.trim().to_string();
    let client_secret = client_secret.trim().to_string();
    let code = code.trim().to_string();
    if client_id.is_empty() || !client_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("enter the numeric client id first".into());
    }
    if client_secret.is_empty() {
        return Err("enter the client secret first".into());
    }
    if code.is_empty() {
        return Err("paste the authorization code first".into());
    }
    let token = state
        .inner()
        .anilist
        .exchange_code(&client_id, &client_secret, &code)
        .await?;
    let data = state
        .inner()
        .anilist
        .graphql_auth(
            &token,
            "query { Viewer { name mediaListOptions { scoreFormat } } }",
            json!({}),
        )
        .await?;
    let viewer = data
        .get("Viewer")
        .ok_or_else(|| "AniList did not return a user".to_string())?;
    let username = viewer
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if username.is_empty() {
        return Err("AniList did not return a user".into());
    }
    let score_format = viewer
        .pointer("/mediaListOptions/scoreFormat")
        .and_then(|v| v.as_str())
        .unwrap_or("POINT_10")
        .to_string();
    let db = &state.inner().db;
    db.settings_set("anilist_token", &json!(token));
    db.settings_set("anilist_username", &json!(username));
    db.settings_set("anilist_score_format", &json!(score_format));
    Ok(AniListAccount {
        username,
        score_format,
    })
}

#[tauri::command]
pub fn anilist_disconnect(state: S<'_>) {
    let db = &state.inner().db;
    db.settings_set("anilist_token", &json!(""));
    db.settings_set("anilist_username", &json!(""));
    db.settings_set("anilist_sync", &json!(false));
}

fn score_for_format(format: &str, score: i64) -> f64 {
    if score <= 0 {
        return 0.0;
    }
    match format {
        "POINT_100" => score as f64 * 10.0,
        "POINT_10_DECIMAL" => score as f64,
        "POINT_5" => ((score as f64) / 2.0).round().clamp(1.0, 5.0),
        "POINT_3" => ((score as f64) * 0.3).round().clamp(1.0, 3.0),
        _ => score as f64,
    }
}

fn fuzzy_date(date: Option<&str>) -> Option<serde_json::Value> {
    let mut parts = date?.split('-');
    let year: i64 = parts.next()?.parse().ok()?;
    if year <= 0 {
        return None;
    }
    let month: i64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let day: i64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut obj = serde_json::Map::new();
    obj.insert("year".into(), json!(year));
    if month > 0 {
        obj.insert("month".into(), json!(month));
    }
    if day > 0 {
        obj.insert("day".into(), json!(day));
    }
    Some(serde_json::Value::Object(obj))
}

#[tauri::command]
pub async fn anilist_push_entry(state: S<'_>, id: i64) -> Result<(), String> {
    let app = state.inner();
    let db = &app.db;
    let enabled = db
        .settings_get("anilist_sync")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }
    let token = setting_str(app, "anilist_token");
    if token.is_empty() {
        return Ok(());
    }
    let entry = db.entry_get(id).ok_or_else(|| "entry not found".to_string())?;
    let score_format = {
        let f = setting_str(app, "anilist_score_format");
        if f.is_empty() {
            "POINT_10".to_string()
        } else {
            f
        }
    };

    let anilist = &app.anilist;
    // never roll AniList backwards if it is ahead of this app
    let remote = anilist
        .graphql_auth(
            &token,
            "query ($mediaId: Int) { Media(id: $mediaId) { mediaListEntry { progress repeat } } }",
            json!({ "mediaId": entry.anilist_id }),
        )
        .await?;
    let mut remote_repeat = 0i64;
    if let Some(r) = remote.pointer("/Media/mediaListEntry") {
        let remote_progress = r.get("progress").and_then(|v| v.as_i64()).unwrap_or(0);
        remote_repeat = r.get("repeat").and_then(|v| v.as_i64()).unwrap_or(0);
        if remote_progress > entry.progress && remote_repeat >= entry.rewatches {
            return Ok(());
        }
    }

    let started_at = fuzzy_date(entry.start_date.as_deref());
    let completed_at = fuzzy_date(entry.finish_date.as_deref());
    let mut decls = vec![
        "$mediaId: Int",
        "$status: MediaListStatus",
        "$progress: Int",
        "$score: Float",
    ];
    let mut args = vec![
        "mediaId: $mediaId",
        "status: $status",
        "progress: $progress",
        "score: $score",
    ];
    let push_repeat = entry.rewatches >= remote_repeat;
    if push_repeat {
        decls.push("$repeat: Int");
        args.push("repeat: $repeat");
    }
    if started_at.is_some() {
        decls.push("$startedAt: FuzzyDateInput");
        args.push("startedAt: $startedAt");
    }
    if completed_at.is_some() {
        decls.push("$completedAt: FuzzyDateInput");
        args.push("completedAt: $completedAt");
    }
    let query = format!(
        "mutation ({}) {{ SaveMediaListEntry({}) {{ id }} }}",
        decls.join(", "),
        args.join(", ")
    );
    let mut vars = json!({
        "mediaId": entry.anilist_id,
        "status": entry.status,
        "progress": entry.progress,
        "score": score_for_format(&score_format, entry.score),
    });
    if push_repeat {
        vars["repeat"] = json!(entry.rewatches);
    }
    if let Some(v) = started_at {
        vars["startedAt"] = v;
    }
    if let Some(v) = completed_at {
        vars["completedAt"] = v;
    }
    anilist
        .graphql_auth(&token, &query, vars)
        .await
        .map(|_| ())
}

// ---------- anilist pull ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    pub added: usize,
    pub updated: usize,
    pub kept_local: usize,
    pub custom_lists_created: usize,
}

/// AniList reports scores on a 0-100 scale here; the app stores 0-10.
fn score_from_remote(score_point100: i64) -> i64 {
    if score_point100 <= 0 {
        return 0;
    }
    ((score_point100 as f64 / 10.0).round() as i64).clamp(1, 10)
}

fn fuzzy_date_string(v: Option<&serde_json::Value>) -> Option<String> {
    let v = v?;
    let year = v.get("year").and_then(|x| x.as_i64())?;
    if year <= 0 {
        return None;
    }
    let month = v.get("month").and_then(|x| x.as_i64()).unwrap_or(0);
    let day = v.get("day").and_then(|x| x.as_i64()).unwrap_or(0);
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

/// One-shot manual import: copies the user's AniList lists into the local
/// database. New entries are added, existing ones updated (remote wins, but
/// empty remote values never blank local data and progress never rolls back),
/// local-only entries are kept. Pending pushes should be flushed by the
/// frontend before calling this.
#[tauri::command]
pub async fn anilist_pull(state: S<'_>) -> Result<PullReport, String> {
    let app_state = state.inner().clone();
    let db = app_state.db.clone();
    let anilist = app_state.anilist.clone();
    let token = setting_str(&app_state, "anilist_token");
    if token.is_empty() {
        return Err("connect to AniList first".into());
    }
    let user_id = anilist.viewer_id(&token).await?;

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut lists_created = 0usize;
    let mut seen: std::collections::HashSet<(String, i64)> = std::collections::HashSet::new();

    for media_type in ["ANIME", "MANGA"] {
        let data = anilist
            .media_list_collection(&token, user_id, media_type)
            .await?;
        let lists = data
            .pointer("/MediaListCollection/lists")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for list in &lists {
            let entries = list
                .get("entries")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            for entry in &entries {
                let media = entry
                    .get("media")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let Some(media_id) = media.get("id").and_then(|x| x.as_i64()) else {
                    continue;
                };
                // each entry also appears in its custom-list group; only the
                // first occurrence carries the merge, but customLists on the
                // entry object is the full union either way
                if !seen.insert((media_type.to_string(), media_id)) {
                    continue;
                }
                db.media_upsert(&MediaRow::from_json(&media))
                    .map_err(fmt_err)?;

                // map the first enabled AniList custom list to a local one,
                // creating it when the name is new
                let mut custom_list_id: Option<i64> = None;
                for cl in entry
                    .get("customLists")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                {
                    if !cl.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true) {
                        continue;
                    }
                    let Some(name) = cl.get("name").and_then(|x| x.as_str()) else {
                        continue;
                    };
                    if name.trim().is_empty() {
                        continue;
                    }
                    let find = || {
                        db.custom_lists()
                            .into_iter()
                            .find(|l| l.media_type == media_type && l.name == name)
                            .map(|l| l.id)
                    };
                    custom_list_id = find();
                    if custom_list_id.is_none() {
                        if db.custom_list_add(media_type, name).is_ok() {
                            lists_created += 1;
                        }
                        custom_list_id = find();
                    }
                    if custom_list_id.is_some() {
                        break;
                    }
                }

                let mut status = entry
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("PLANNING")
                    .to_string();
                let mut rewatches = entry.get("repeat").and_then(|v| v.as_i64()).unwrap_or(0);
                if status == "REPEATING" {
                    // the app models rewatching as Watching + a rewatches count
                    status = "CURRENT".into();
                    rewatches = rewatches.max(1);
                }

                let pe = crate::db::PullEntry {
                    anilist_id: media_id,
                    media_type: media_type.to_string(),
                    status,
                    custom_list_id,
                    score: score_from_remote(
                        entry.get("score").and_then(|v| v.as_i64()).unwrap_or(0),
                    ),
                    progress: entry.get("progress").and_then(|v| v.as_i64()).unwrap_or(0),
                    rewatches,
                    start_date: fuzzy_date_string(entry.get("startedAt")),
                    finish_date: fuzzy_date_string(entry.get("completedAt")),
                    notes: entry
                        .get("notes")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                };
                if db.entry_pull_upsert(&pe).map_err(fmt_err)? {
                    added += 1;
                } else {
                    updated += 1;
                }
            }
        }
    }

    let kept_local = db
        .entries_get(None, None, None)
        .into_iter()
        .filter(|e| !seen.contains(&(e.media_type.clone(), e.anilist_id)))
        .count();

    // fill the cover cache for anything new, quietly, in the background
    let db2 = db.clone();
    tauri::async_runtime::spawn(async move {
        cache_missing_covers(db2, None).await;
    });

    Ok(PullReport {
        added,
        updated,
        kept_local,
        custom_lists_created: lists_created,
    })
}

// ---------- browser ----------

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("only http(s) URLs can be opened".into());
    }
    open_browser(&url)
}

// ---------- export / import ----------

#[tauri::command]
pub async fn export_mal(app: AppHandle, state: S<'_>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let app2 = app.clone();
    let dir = tauri::async_runtime::spawn_blocking(move || app2.dialog().file().blocking_pick_folder())
        .await
        .map_err(fmt_err)?
        .ok_or_else(|| "export cancelled".to_string())?;
    let dir = dir.into_path().map_err(fmt_err)?;

    let db = state.inner().db.clone();
    let anilist = state.inner().anilist.clone();
    // ensure MAL ids (rate limited)
    let entries = db.entries_get(None, None, None);
    let total = entries.len();
    for (i, e) in entries.iter().enumerate() {
        let mid = db
            .media_get(e.anilist_id)
            .and_then(|m| m.get("malId").and_then(|x| x.as_i64()));
        if mid.is_none() {
            if let Ok(v) = anilist.media_by_id(e.anilist_id).await {
                let row = MediaRow::from_json(&v);
                if let Some(mal) = row.mal_id {
                    db.media_set_mal_id(e.anilist_id, mal);
                }
            }
        }
        if i % 10 == 0 || i + 1 == total {
            app.emit("export-progress", json!({ "processed": i + 1, "total": total }))
                .ok();
        }
    }
    let xml = crate::export::build_export_xml(&db)?;
    let path_anime = dir.join("animelist_export.xml");
    let path_manga = dir.join("mangalist_export.xml");
    let mut written = String::new();
    if let Some(sec) = crate::export::section_only(&xml, "anime") {
        std::fs::write(&path_anime, sec).map_err(fmt_err)?;
        written.push_str(&path_anime.display().to_string());
    }
    if let Some(sec) = crate::export::section_only(&xml, "manga") {
        std::fs::write(&path_manga, sec).map_err(fmt_err)?;
        if !written.is_empty() {
            written.push_str(" and ");
        }
        written.push_str(&path_manga.display().to_string());
    }
    if written.is_empty() {
        return Err("no entries to export".into());
    }
    Ok(format!("Exported to {written}"))
}

#[tauri::command]
pub async fn import_mal(
    app: AppHandle,
    state: S<'_>,
) -> Result<crate::export::ImportReport, String> {
    use tauri_plugin_dialog::DialogExt;
    let app2 = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        app2.dialog()
            .file()
            .add_filter("MAL XML", &["xml"])
            .blocking_pick_file()
    })
    .await
    .map_err(fmt_err)?
    .ok_or_else(|| "import cancelled".to_string())?;
    let file = file.into_path().map_err(fmt_err)?;

    let xml = std::fs::read_to_string(&file).map_err(fmt_err)?;
    let items = crate::export::parse_mal_xml(&xml)?;
    let db = state.inner().db.clone();
    let anilist = state.inner().anilist.clone();
    let report = crate::export::import_items(&db, &anilist, items, |processed, total, current| {
        app.emit(
            "import-progress",
            json!({ "processed": processed, "total": total, "current": current }),
        )
        .ok();
    })
    .await;
    Ok(report)
}