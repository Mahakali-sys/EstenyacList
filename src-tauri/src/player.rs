//! Own torrent streaming: an embedded rqbit engine downloads (sequentially,
//! prioritizing the file being played) and serves files over a localhost HTTP
//! endpoint; mpv — in-process via libmpv when available, external mpv.exe
//! otherwise — plays that stream. No more webtorrent-mpv-hook dependency.

use crate::scheduler::AppState;
use librqbit::api::{Api, TorrentIdOrHash};
use librqbit::http_api::HttpApi;
use librqbit::storage::examples::inmemory::InMemoryExampleStorageFactory;
use librqbit::storage::StorageFactoryExt;
use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session, SessionOptions};
use librqbit_dualstack_sockets::socket::{BindOpts, MaybeDualstackSocket};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

pub struct TorrentEngine {
    pub session: Arc<Session>,
    pub base_url: String,
    pub current: Mutex<Option<ActiveStream>>,
}

#[derive(Clone)]
pub struct ActiveStream {
    pub infohash: String,
    pub handle: Arc<ManagedTorrent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamTarget {
    pub url: String,
    pub title: Option<String>,
    pub size: Option<u64>,
    pub infohash: String,
    pub file_index: usize,
    pub filename: String,
}

const VIDEO_EXTS: [&str; 11] = [
    "mkv", "mp4", "avi", "mov", "m4v", "ts", "m2ts", "flv", "wmv", "webm", "mpg",
];

/// Creates the rqbit session + localhost HTTP API on first use.
pub async fn ensure_engine(state: &AppState) -> Result<Arc<TorrentEngine>, String> {
    let mut guard = state.engine.lock().await;
    if let Some(engine) = guard.as_ref() {
        return Ok(engine.clone());
    }
    let dir = crate::db::exe_dir().join("cache").join("torrents");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create download dir: {e}"))?;
    // uploads stay off: in the in-memory modes evicted pieces can't be seeded
    // back anyway, and this is a personal streaming setup
    let session = Session::new_with_opts(
        dir,
        SessionOptions {
            disable_upload: true,
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("could not start the torrent engine: {e}"))?;
    // ephemeral localhost port, bound here so we know it up front
    let listener = MaybeDualstackSocket::bind_tcp(
        std::net::SocketAddr::from(([127, 0, 0, 1], 0)),
        BindOpts::default(),
    )
    .map_err(|e| format!("could not bind streaming port: {e}"))?;
    let port = listener.bind_addr().port();
    let api = Api::new(session.clone(), None, None);
    let server = HttpApi::new(api, None).make_http_api_and_run(listener, None);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = server.await {
            log::warn!("torrent http api stopped: {e}");
        }
    });
    let engine = Arc::new(TorrentEngine {
        session,
        base_url: format!("http://127.0.0.1:{port}"),
        current: Mutex::new(None),
    });
    *guard = Some(engine.clone());
    let base = engine.base_url.clone();
    log::info!("torrent engine ready, streaming on {base}");
    Ok(engine)
}

fn pick_video_file(files: &[(String, u64)], episode: Option<i64>) -> usize {
    let largest = |idx: &[usize]| -> usize {
        idx.iter()
            .copied()
            .max_by_key(|&i| files[i].1)
            .unwrap_or(0)
    };
    let video: Vec<usize> = files
        .iter()
        .enumerate()
        .filter(|(_, (name, _))| {
            let ext = name
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_lowercase();
            VIDEO_EXTS.contains(&ext.as_str())
        })
        .map(|(i, _)| i)
        .collect();
    if video.is_empty() {
        // no recognizable video extension — just take the largest file
        return largest(&(0..files.len()).collect::<Vec<_>>());
    }
    if let Some(ep) = episode {
        // multi-episode packs: prefer the file for the requested episode
        let ep = ep.max(0);
        let ep_str = ep.to_string();
        let ep2 = format!("{ep:02}");
        let matches: Vec<usize> = video
            .iter()
            .copied()
            .filter(|&i| {
                let n = crate::nyaa::normalize(&files[i].0);
                n.contains(&format!(" {ep_str} "))
                    || n.contains(&format!(" {ep2} "))
                    || n.ends_with(&format!(" {ep_str}"))
                    || n.contains(&format!("e{ep2} "))
            })
            .collect();
        if !matches.is_empty() {
            return largest(&matches);
        }
    }
    largest(&video)
}

/// Files over this size fall back to disk even with full-RAM streaming on,
/// to keep a freak batch/movie from exhausting memory.
const RAM_LIMIT_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// "ram" = whole file in memory, "disk" = write to cache\torrents. Falls back
/// to the pre-migration `ram_streaming` bool, then to "ram". The removed
/// "sliding" mode is treated as "ram".
fn stream_mode(state: &AppState) -> &'static str {
    if let Some(v) = state
        .db
        .settings_get("stream_mode")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
    {
        return if v == "disk" { "disk" } else { "ram" };
    }
    if state
        .db
        .settings_get("ram_streaming")
        .and_then(|v| v.as_bool())
        == Some(false)
    {
        return "disk";
    }
    "ram"
}

fn storage_opts(state: &AppState) -> (Option<AddTorrentOptions>, &'static str) {
    match stream_mode(state) {
        "disk" => (None, "disk"),
        _ => (
            Some(AddTorrentOptions {
                storage_factory: Some(InMemoryExampleStorageFactory {}.boxed()),
                ..Default::default()
            }),
            "ram",
        ),
    }
}

/// Adds the torrent and waits for its metadata (magnets can take a while;
/// gives up after 2 minutes). Fails fast when the torrent enters an error
/// state instead of spinning out the whole timeout.
async fn add_and_wait(
    engine: &TorrentEngine,
    source: &str,
    opts: Option<AddTorrentOptions>,
) -> Result<(Arc<ManagedTorrent>, Vec<(String, u64)>), String> {
    log::info!("adding torrent (waiting up to 120 s for metadata)");
    let handle = engine
        .session
        .add_torrent(AddTorrent::from_url(source), opts)
        .await
        .map_err(|e| {
            let msg = format!("could not add torrent: {e}");
            log::warn!("{msg}");
            msg
        })?
        .into_handle()
        .ok_or("torrent already managed but no handle available")?;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(err) = handle.stats().error {
            log::warn!("torrent entered error state: {err}");
            // drop it from the session so a broken torrent doesn't keep
            // retrying (and holding its storage) in the background
            let _ = engine
                .session
                .delete(TorrentIdOrHash::Hash(handle.info_hash()), false)
                .await;
            return Err(format!("torrent failed: {err}"));
        }
        match handle.with_metadata(|m| {
            m.file_infos
                .iter()
                .map(|f| (f.relative_filename.to_string_lossy().to_string(), f.len))
                .collect::<Vec<(String, u64)>>()
        }) {
            Ok(files) => {
                log::info!("metadata ready ({} files)", files.len());
                return Ok((handle, files));
            }
            Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            Err(_) => {
                let _ = engine
                    .session
                    .delete(TorrentIdOrHash::Hash(handle.info_hash()), false)
                    .await;
                return Err(
                    "timed out waiting for torrent metadata (no seeds?)".into(),
                );
            }
        }
    }
}

/// Adds the torrent (magnet or URL), waits for metadata, picks the video file
/// and returns the localhost stream URL for it, plus the torrent handle.
pub async fn resolve_stream(
    engine: &TorrentEngine,
    source: &str,
    opts: Option<AddTorrentOptions>,
    mode: &'static str,
    title: Option<String>,
    episode: Option<i64>,
) -> Result<(StreamTarget, Arc<ManagedTorrent>), String> {
    let started = Instant::now();
    let (mut handle, mut files) = add_and_wait(engine, source, opts).await?;
    log::info!("metadata ready in {:.1}s", started.elapsed().as_secs_f32());

    let mut file_index = pick_video_file(&files, episode);
    let (mut filename, mut size) = files
        .get(file_index)
        .cloned()
        .ok_or("torrent has no files")?;

    // full-RAM storage was chosen before we knew the file size; an oversized
    // file gets re-added with the regular disk storage instead.
    let mut effective_mode = mode;
    if mode == "ram" && size > RAM_LIMIT_BYTES {
        log::info!(
            "selected file is {} bytes (> RAM limit); restarting on disk storage",
            size
        );
        let _ = engine
            .session
            .delete(TorrentIdOrHash::Hash(handle.info_hash()), false)
            .await;
        let (h2, f2) = add_and_wait(engine, source, None).await?;
        handle = h2;
        files = f2;
        file_index = pick_video_file(&files, episode);
        (filename, size) = files
            .get(file_index)
            .cloned()
            .ok_or("torrent has no files")?;
        effective_mode = "disk";
    }

    let infohash: String = handle
        .info_hash()
        .0
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    log::info!(
        "stream resolved ({effective_mode}): file {file_index} {:?} ({} bytes), infohash {infohash}",
        filename,
        size
    );

    // only download the file being played; batches would otherwise pull
    // every episode at once
    let _ = engine
        .session
        .update_only_files(&handle, &HashSet::from([file_index]))
        .await;

    let encoded = crate::nyaa::percent_encode_dn(&filename);
    let url = format!(
        "{}/torrents/{infohash}/stream/{file_index}/{encoded}",
        engine.base_url
    );
    Ok((
        StreamTarget {
            url,
            title,
            size: Some(size),
            infohash,
            file_index,
            filename,
        },
        handle,
    ))
}

/// Per-stream background task: emits torrent progress once a second. Exits
/// when this torrent stops being the current one.
fn spawn_stream_monitor(app: AppHandle, infohash: String) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let Some(state) = app.try_state::<Arc<AppState>>() else { return };

            let stats = {
                let engine_guard = state.engine.lock().await;
                let Some(engine) = engine_guard.as_ref() else { return };
                let current = engine.current.lock().await;
                let Some(active) = current.as_ref() else { return };
                if active.infohash != infohash {
                    return;
                }
                active.handle.stats()
            };

            let total = stats.total_bytes;
            let downloaded = stats.progress_bytes;
            let speed = stats
                .live
                .as_ref()
                .map(|l| l.download_speed.as_bytes())
                .unwrap_or(0);
            app.emit(
                "player-torrent",
                serde_json::json!({
                    "infohash": infohash,
                    "downloadedBytes": downloaded,
                    "totalBytes": total,
                    "speedBytesPerSec": speed,
                    "percent": if total > 0 { (downloaded as f64 / total as f64) * 100.0 } else { 0.0 },
                }),
            )
            .ok();
        }
    });
}

/// Forgets the active stream and removes its torrent from the session.
async fn release_current(engine: &TorrentEngine, delete_files: bool) {
    let active = engine.current.lock().await.take();
    if let Some(active) = active {
        let _ = engine
            .session
            .delete(
                TorrentIdOrHash::Hash(active.handle.info_hash()),
                delete_files,
            )
            .await;
    }
}

#[tauri::command]
pub async fn player_open(
    app: AppHandle,
    state: crate::commands::S<'_>,
    source: String,
    title: Option<String>,
    entry_id: Option<i64>,
    episode: Option<i64>,
) -> Result<(), String> {
    let app_state = state.inner().clone();
    let head: String = source.trim().chars().take(90).collect();
    log::info!(
        "player_open: source {head}…, title {title:?}, entry {entry_id:?}, ep {episode:?}"
    );
    let engine = ensure_engine(&app_state).await?;
    let (opts, storage_mode) = storage_opts(&app_state);
    log::info!("player_open: engine ready, storage mode {storage_mode}");
    let (target, handle) = resolve_stream(
        &engine,
        source.trim(),
        opts,
        storage_mode,
        title.clone(),
        episode,
    )
    .await?;

    // remember what is playing (and forget the previous stream)
    {
        let mut current = engine.current.lock().await;
        if let Some(prev) = current.take() {
            if prev.infohash != target.infohash {
                let _ = engine
                    .session
                    .delete(
                        TorrentIdOrHash::Hash(prev.handle.info_hash()),
                        false,
                    )
                    .await;
            }
        }
        *current = Some(ActiveStream {
            infohash: target.infohash.clone(),
            handle: handle.clone(),
        });
    }
    spawn_stream_monitor(app.clone(), target.infohash.clone());

    // built-in player when libmpv is present; external mpv.exe plays the same
    // stream URL otherwise (no webtorrent-hook needed anymore)
    log::info!("player_open: opening player for {}", target.url);
    // a previous stream may have been playing in an external mpv window
    crate::mpv::quit_active();
    let stream_url = target.url.clone();
    let app_for_open = app.clone();
    let title_for_open = title.clone();
    let audio_lang = app_state
        .db
        .settings_get("audio_lang")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let sub_lang = app_state
        .db
        .settings_get("sub_lang")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let audio_for_open = audio_lang.clone();
    let sub_for_open = sub_lang.clone();
    let embedded = tauri::async_runtime::spawn_blocking(move || {
        open_embedded(
            &app_for_open,
            &stream_url,
            title_for_open,
            entry_id,
            episode,
            audio_for_open,
            sub_for_open,
        )
    })
    .await
    .unwrap_or_else(|e| Err(format!("player task failed: {e}")));
    let mode = match embedded {
        Ok(_) => {
            log::info!("player_open: embedded player opened");
            "embedded"
        }
        Err(e) => {
            log::info!("built-in player unavailable ({e}); using external mpv");
            if let Err(e) = open_external(
                &app,
                &app_state,
                &target.url,
                entry_id,
                episode,
                &audio_lang,
                &sub_lang,
            ) {
                // nothing can play this stream — stop it instead of leaving a
                // torrent downloading in the background with no player
                release_current(&engine, false).await;
                return Err(e);
            }
            log::info!("player_open: external mpv launched");
            "external"
        }
    };
    app.emit(
        "player-opened",
        serde_json::json!({
            "mode": mode,
            "title": title.unwrap_or_else(|| target.filename.clone()),
            "entryId": entry_id,
            "episode": episode,
            "size": target.size,
            "streamUrl": target.url,
        }),
    )
    .ok();
    Ok(())
}

/// Opens the embedded player. Everything that touches the video child window
/// or the mpv instance runs on the main/UI thread: the overlay window is a
/// Win32 child of the Tauri window and libmpv embeds into it via `wid`, both
/// of which belong on the thread that pumps that window's messages.
fn open_embedded(
    app: &AppHandle,
    url: &str,
    title: Option<String>,
    entry_id: Option<i64>,
    episode: Option<i64>,
    audio_lang: String,
    sub_lang: String,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let url = url.to_string();
    let app2 = app.clone();
    // if the main thread is busy past our timeout we fall back to external
    // mpv; the queued closure must then not also start embedded playback
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cancelled_in = cancelled.clone();
    app.run_on_main_thread(move || {
        use std::sync::atomic::Ordering;
        let result = (|| -> Result<(), String> {
            if cancelled_in.load(Ordering::SeqCst) {
                return Err("embedded player open cancelled".into());
            }
            let window = app2
                .get_webview_window("main")
                .ok_or("main window not found")?;
            let hwnd = window
                .hwnd()
                .map_err(|e| format!("no window handle: {e}"))?
                .0 as isize;
            log::info!("open_embedded: creating/reusing mpv (hwnd {hwnd:x})");
            let player = crate::mpv_embed::EmbeddedPlayer::get_or_create(hwnd, app2.clone())?;
            if cancelled_in.load(Ordering::SeqCst) {
                return Err("embedded player open cancelled".into());
            }
            player.apply_track_prefs(&audio_lang, &sub_lang);
            player.load(&url, title, entry_id, episode)?;
            crate::mpv_embed::layout_for_window(&window);
            Ok(())
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| format!("could not dispatch to the main thread: {e}"))?;
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(r) => r,
        Err(_) => {
            cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
            // in case the closure won the race and already started playback,
            // hide it so the external fallback isn't playing over/under it
            if let Some(player) = crate::mpv_embed::current_player() {
                player.stop_and_hide();
            }
            Err("embedded player open timed out".into())
        }
    }
}

fn open_external(
    app: &AppHandle,
    app_state: &Arc<AppState>,
    url: &str,
    entry_id: Option<i64>,
    episode: Option<i64>,
    audio_lang: &str,
    sub_lang: &str,
) -> Result<(), String> {
    let mpv_path = app_state
        .db
        .settings_get("mpv_path")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    // always expose IPC: it lets the app close the external player and, when
    // the stream is tied to a list entry, record the finished episode
    let pipe = format!(
        r"\\.\pipe\estenyac_list_{}",
        chrono::Utc::now().timestamp_millis()
    );
    // same playback defaults as the built-in player (see mpv_embed); language
    // preferences are only passed when the user configured them
    let mut args: Vec<String> = vec!["--volume=60".into()];
    if !audio_lang.trim().is_empty() {
        args.push(format!("--alang={}", audio_lang.trim()));
    }
    if !sub_lang.trim().is_empty() {
        args.push(format!("--slang={}", sub_lang.trim()));
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    crate::mpv::open_magnet(url, &mpv_path, Some(&pipe), &arg_refs)?;
    let cancelled = crate::mpv::register_external(&pipe);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::mpv::watch_finish(app, pipe, entry_id, episode, cancelled).await;
    });
    Ok(())
}

/// Whether the in-process libmpv player is available (else external mpv.exe
/// is used against the same stream).
#[tauri::command]
pub fn player_available() -> bool {
    crate::mpv_embed::lib_available()
}

#[tauri::command]
pub fn player_toggle_pause() -> Result<(), String> {
    crate::mpv_embed::current_player()
        .ok_or("no built-in player running")?
        .toggle_pause()
}

#[tauri::command]
pub fn player_set_paused(paused: bool) -> Result<(), String> {
    crate::mpv_embed::current_player()
        .ok_or("no built-in player running")?
        .set_paused(paused)
}

#[tauri::command]
pub fn player_seek(seconds: f64) -> Result<(), String> {
    crate::mpv_embed::current_player()
        .ok_or("no built-in player running")?
        .seek_abs(seconds);
    Ok(())
}

#[tauri::command]
pub fn player_seek_rel(seconds: f64) -> Result<(), String> {
    crate::mpv_embed::current_player()
        .ok_or("no built-in player running")?
        .seek_rel(seconds);
    Ok(())
}

#[tauri::command]
pub fn player_set_volume(volume: f64) -> Result<(), String> {
    crate::mpv_embed::current_player()
        .ok_or("no built-in player running")?
        .set_volume(volume)
}

#[tauri::command]
pub fn player_tracks() -> Vec<crate::mpv_embed::TrackInfo> {
    crate::mpv_embed::current_player()
        .map(|p| p.tracks())
        .unwrap_or_default()
}

#[tauri::command]
pub fn player_set_audio_track(id: Option<i64>) -> Result<Vec<crate::mpv_embed::TrackInfo>, String> {
    let player = crate::mpv_embed::current_player().ok_or("no built-in player running")?;
    player.set_audio_track(id)?;
    Ok(player.tracks())
}

#[tauri::command]
pub fn player_set_subtitle_track(
    id: Option<i64>,
    auto: bool,
) -> Result<Vec<crate::mpv_embed::TrackInfo>, String> {
    let player = crate::mpv_embed::current_player().ok_or("no built-in player running")?;
    player.set_subtitle_track(id, auto)?;
    Ok(player.tracks())
}

/// Stops playback, hides the overlay and (optionally, per settings) deletes
/// the downloaded files.
#[tauri::command]
pub async fn player_close(state: crate::commands::S<'_>) -> Result<(), String> {
    let app_state = state.inner().clone();
    log::info!("player_close");
    if let Some(player) = crate::mpv_embed::current_player() {
        player.stop_and_hide();
    }
    // external mpv plays the localhost stream too — close it before the
    // torrent disappears from under it
    crate::mpv::quit_active();
    let delete_files = app_state
        .db
        .settings_get("delete_after_watch")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let engine = app_state.engine.lock().await.clone();
    if let Some(engine) = engine {
        release_current(&engine, delete_files).await;
    }
    Ok(())
}
