use crate::anilist::{AniList, ScheduleMedia};
use crate::db::{Db, MediaRow};
use crate::neko::{Neko, NekoFilters};
use crate::nyaa::{Nyaa, NyaaFilters};
use chrono::Timelike;
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub struct AppState {
    pub db: Arc<Db>,
    pub anilist: Arc<AniList>,
    pub nyaa: Arc<Nyaa>,
    pub neko: Arc<Neko>,
    pub syncing: std::sync::atomic::AtomicBool,
    pub searching: std::sync::atomic::AtomicBool,
    /// embedded torrent engine, created lazily on first playback
    pub engine: tokio::sync::Mutex<Option<Arc<crate::player::TorrentEngine>>>,
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // on open: immediately search anything already aired 15+ min ago
        let state = app.state::<Arc<AppState>>().inner().clone();
        let started = state
            .searching
            .compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
            .is_ok();
        if started {
            check_pending_releases(state.clone(), &app).await;
            state.searching.store(false, std::sync::atomic::Ordering::SeqCst);
        }
        let mut tick: u64 = 0;
        loop {
            let state = app.state::<Arc<AppState>>().inner().clone();
            let now = chrono::Utc::now().timestamp();
            let should_sync = should_sync_schedule(&state, now);
            if should_sync {
                let started = state
                    .syncing
                    .compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
                    .is_ok();
                if started {
                    log::info!("syncing airing schedule");
                    state.db.settings_set("last_schedule_attempt", &json!(now));
                    let st = state.clone();
                    match sync_schedule(st).await {
                        Ok(count) => {
                            app.emit("schedule-synced", json!({ "count": count })).ok();
                        }
                        Err(e) => {
                            log::warn!("schedule sync failed: {e}");
                        }
                    }
                    state.syncing.store(false, std::sync::atomic::Ordering::SeqCst);
                }
            } else if tick % 2 == 1 {
                // check for releases every other tick (30s => 60s cadence)
                let started = state
                    .searching
                    .compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
                    .is_ok();
                if started {
                    let st = state.clone();
                    let app2 = app.clone();
                    tauri::async_runtime::spawn(async move {
                        check_pending_releases(st.clone(), &app2).await;
                        st.searching.store(false, std::sync::atomic::Ordering::SeqCst);
                    });
                }
            }
            // prune old schedule rows occasionally
            if tick % 30 == 29 {
                state.db.schedule_purge_past(chrono::Utc::now().timestamp());
            }
            tick += 1;
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}

fn should_sync_schedule(state: &AppState, now: i64) -> bool {
    // don't hammer AniList when the network is down: retry at most every
    // 10 minutes, independent of whether the last attempt succeeded
    if let Some(last_attempt) = state
        .db
        .settings_get("last_schedule_attempt")
        .and_then(|v| v.as_i64())
    {
        if now - last_attempt < 10 * 60 {
            return false;
        }
    }
    let last_sync = state
        .db
        .settings_get("last_schedule_sync")
        .and_then(|v| v.as_i64());
    let Some(last_sync) = last_sync else {
        return true;
    };
    if now - last_sync > 20 * 3600 {
        return true;
    }
    // refresh around 00:30 in São Paulo time
    let last_dt = chrono::DateTime::from_timestamp(last_sync, 0)
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
    let today = chrono::Utc::now()
        .with_timezone(&chrono_tz::America::Sao_Paulo);
    let last_day = last_dt.with_timezone(&chrono_tz::America::Sao_Paulo);
    let now_minutes = today.hour() * 60 + today.minute();
    now_minutes >= 30 && today.date_naive() != last_day.date_naive()
}

/// One-time-ish backfill: refetches AniList metadata for listed anime whose
/// cached media row is missing the episode duration, so stats can use real
/// lengths instead of the 24-minute fallback. Rate limited by AniList's own
/// client; exits quickly once every listed title has a duration.
pub async fn backfill_durations(db: Arc<Db>, anilist: Arc<AniList>) {
    let ids = db.media_missing_duration();
    if ids.is_empty() {
        return;
    }
    log::info!("backfilling durations for {} titles", ids.len());
    for id in ids {
        match anilist.media_by_id(id).await {
            Ok(v) => {
                let _ = db.media_upsert(&MediaRow::from_json(&v));
            }
            Err(e) => {
                log::warn!("duration backfill failed for {id}: {e}");
            }
        }
    }
}

pub async fn sync_schedule(state: Arc<AppState>) -> Result<usize, String> {    let now = chrono::Utc::now().timestamp();
    let to = now + 7 * 24 * 3600 + 3600;
    let items = state.anilist.schedule(now, to).await?;
    log::info!("schedule fetched: {} items", items.len());
    let mut count = 0usize;
    for sm in items {
        let ScheduleMedia { media, airing_at, episode } = sm;
        if media.media_type != "ANIME" || media.status.as_deref() != Some("RELEASING") {
            continue;
        }
        let mj = serde_json::to_value(&media).unwrap_or(json!({}));
        let media_row = MediaRow {
            anilist_id: media.id,
            mal_id: media.id_mal,
            media_type: "ANIME".into(),
            title_romaji: media.title_romaji.clone(),
            title_english: media.title_english.clone(),
            title_native: media.title_native.clone(),
            format: media.format.clone(),
            status: media.status.clone(),
            episodes: media.episodes,
            chapters: None,
            volumes: None,
            cover_url: media.cover_url.clone(),
            description: None,
            average_score: media.average_score,
            genres: media
                .genres
                .as_ref()
                .map(|g| g.join(", ")),
            studios: None,
            season: media.season.clone(),
            season_year: media.season_year,
            duration: None,
        };
        let _ = state.db.media_upsert(&media_row);
        state.db.schedule_upsert(
            media.id,
            episode,
            airing_at,
            media.title_romaji.as_deref(),
            media.title_english.as_deref(),
            media.title_native.as_deref(),
            media.cover_url.as_deref(),
            &mj,
        );
        count += 1;
    }
    state.db.settings_set("last_schedule_sync", &json!(now));
    Ok(count)
}

async fn check_pending_releases(state: Arc<AppState>, app: &AppHandle) {
    let now = chrono::Utc::now().timestamp();
    let auto = state
        .db
        .settings_get("auto_search")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !auto {
        return;
    }
    let pending = state.db.schedule_pending_search(now);
    if pending.is_empty() {
        return;
    }
    log::info!("checking releases for {} items", pending.len());
    let filters = state
        .db
        .settings_get("nyaa_filters")
        .map(|v| {
            serde_json::from_value::<NyaaFilters>(v).unwrap_or_else(|_| NyaaFilters::default_filters())
        })
        .unwrap_or_else(NyaaFilters::default_filters);
    let neko_base = state
        .db
        .settings_get("neko_base")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "https://nekobt.to".to_string());
    let neko_key = state
        .db
        .settings_get("neko_key")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    state.neko.set_base(neko_base);
    state.neko.set_key(neko_key);
    let neko_filters = state
        .db
        .settings_get("neko_filters")
        .map(|v| {
            serde_json::from_value::<NekoFilters>(v).unwrap_or_else(|_| NekoFilters::default_filters())
        })
        .unwrap_or_else(NekoFilters::default_filters);
    let tracker = state
        .db
        .settings_get("tracker")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "auto".to_string());
    for item in pending {
        let r = crate::releases::search_for_schedule_item(
            app,
            &state.db,
            &state.nyaa,
            &state.neko,
            &item,
            &filters,
            &neko_filters,
            &tracker,
            true,
        )
        .await;
        match r {
            Ok(n) => log::info!(
                "release search for {} ep{} -> {}",
                item.anilist_id,
                item.episode,
                n
            ),
            Err(e) => log::warn!("release search failed for {} ep{}: {e}", item.anilist_id, item.episode),
        }
    }
}
