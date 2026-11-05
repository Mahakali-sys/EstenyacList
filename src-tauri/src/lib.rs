use crate::anilist::AniList;
use crate::db::Db;
use crate::neko::Neko;
use crate::nyaa::Nyaa;
use crate::scheduler::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::Manager;

mod anilist;
mod commands;
mod db;
mod export;
mod images;
mod logging;
mod mpv;
mod mpv_embed;
mod neko;
mod nyaa;
mod player;
mod releases;
mod scheduler;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        // keep the video overlay sized to the window while playing, and keep
        // it above the WebView2 sibling (which can re-raise itself on focus)
        .on_window_event(move |window, event| {
            if matches!(event, tauri::WindowEvent::Resized(_))
                || matches!(event, tauri::WindowEvent::Focused(true))
            {
                if let Some(win) = window.app_handle().get_webview_window("main") {
                    crate::mpv_embed::layout_for_window(&win);
                }
            }
        })
        .setup(|app| {
            let db = Arc::new(Db::open());
            let db_migrate = db.clone();
            let db_backup = db.clone();
            let db_quality = db.clone();
            let db_duration = db.clone();
            let anilist = Arc::new(AniList::new());
            let anilist_backfill = anilist.clone();
            let state = AppState {
                db,
                anilist,
                nyaa: Arc::new(Nyaa::new()),
                neko: Arc::new(Neko::new(
                    "https://nekobt.to".to_string(),
                    String::new(),
                )),
                syncing: AtomicBool::new(false),
                searching: AtomicBool::new(false),
                engine: tokio::sync::Mutex::new(None),
            };
            app.manage(Arc::new(state));

            // convert pre-JPEG-XL cover caches in the background
            tauri::async_runtime::spawn_blocking(move || {
                crate::images::migrate_legacy_covers(&db_migrate);
            });
            // rolling monthly backup (only writes when this month's file is missing)
            tauri::async_runtime::spawn_blocking(move || {
                let _ = crate::export::write_backup(&db_backup, false);
            });
            // re-encode cached covers when the encoder quality changed
            tauri::async_runtime::spawn(async move {
                crate::images::reencode_covers_for_quality(db_quality).await;
            });
            // fill in missing episode durations for watch-time stats
            tauri::async_runtime::spawn(async move {
                scheduler::backfill_durations(db_duration, anilist_backfill).await;
            });
            scheduler::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_db_path,
            commands::get_entries,
            commands::get_entry,
            commands::add_entry,
            commands::remove_entry,
            commands::update_entry,
            commands::get_custom_lists,
            commands::create_custom_list,
            commands::rename_custom_list,
            commands::delete_custom_list,
            commands::search_anilist,
            commands::search_entries,
            commands::get_media,
            commands::schedule_next_week,
            commands::schedule_status,
            commands::resync_schedule,
            commands::image_data,
            commands::get_releases,
            commands::mark_release_seen,
            commands::clear_releases,
            commands::search_releases_now,
            commands::nyaa_test,
            commands::neko_test,
            commands::neko_search_groups,
            commands::get_media_groups,
            commands::set_media_groups,
            commands::get_search_names,
            commands::set_search_names,
            commands::get_release_filters,
            commands::set_release_filters,
            commands::get_quality_prefs,
            commands::set_quality_prefs,
            commands::reorder_custom_lists,
            commands::get_activity,
            commands::check_mpv,
            commands::get_settings,
            commands::set_settings,
            commands::anilist_connect,
            commands::anilist_disconnect,
            commands::anilist_push_entry,
            commands::anilist_pull,
            commands::open_anilist_auth,
            commands::open_anilist_developer,
            commands::export_mal,
            commands::import_mal,
            commands::clear_image_cache,
            commands::redownload_covers,
            commands::open_url,
            player::player_open,
            player::player_available,
            player::player_toggle_pause,
            player::player_set_paused,
            player::player_seek,
            player::player_seek_rel,
            player::player_set_volume,
            player::player_tracks,
            player::player_set_audio_track,
            player::player_set_subtitle_track,
            player::player_close,
            commands::queue_list,
            commands::queue_add,
            commands::queue_remove,
            commands::queue_clear,
            commands::queue_reorder,
            commands::gap_report,
            commands::run_backup,
            commands::list_backups,
            commands::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}