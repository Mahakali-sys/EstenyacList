use std::process::Command;

pub fn open_magnet(
    magnet: &str,
    mpv_path: &str,
    ipc_server: Option<&str>,
    extra_args: &[&str],
) -> Result<(), String> {
    let magnet = magnet.trim().to_string();
    if magnet.is_empty() {
        return Err("no magnet link".into());
    }
    let mut candidates: Vec<String> = Vec::new();
    if !mpv_path.trim().is_empty() {
        candidates.push(mpv_path.trim().to_string());
    }
    candidates.push("mpv".to_string());
    candidates.push("mpv.exe".to_string());
    for known in ["E:\\mpv\\mpv.exe", "C:\\Program Files\\mpv\\mpv.exe", "C:\\mpv\\mpv.exe"] {
        if std::path::Path::new(known).exists() {
            candidates.push(known.to_string());
        }
    }
    for cand in candidates {
        let mut cmd = Command::new(&cand);
        if let Some(pipe) = ipc_server {
            cmd.arg(format!("--input-ipc-server={pipe}"));
            // stay alive at EOF so the watcher can observe eof-reached, then
            // quit mpv itself after progress has been recorded
            cmd.arg("--keep-open=yes");
            cmd.arg("--idle=yes");
        }
        for arg in extra_args {
            cmd.arg(arg);
        }
        cmd.arg(&magnet);
        if cmd.spawn().is_ok() {
            log::info!("launched mpv ({cand}) with stream URL");
            return Ok(());
        }
    }
    Err(
        "Could not launch mpv. Make sure mpv is in PATH or set its full path in Settings."
            .into(),
    )
}

/// One connection, several JSON IPC queries. Returns values in `names` order;
/// `Null` when the property answer failed or was missing.
fn query_props(pipe: &str, names: &[&str]) -> Option<Vec<serde_json::Value>> {
    use std::io::{BufRead, BufReader, Write};
    let stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(pipe)
        .ok()?;
    let mut writer = stream.try_clone().ok()?;
    for (i, name) in names.iter().enumerate() {
        let cmd = format!(
            "{{\"command\":[\"get_property\",\"{name}\"],\"request_id\":{}}}\n",
            i + 1
        );
        writer.write_all(cmd.as_bytes()).ok()?;
    }
    writer.flush().ok()?;
    let mut reader = BufReader::new(stream);
    let mut out: Vec<Option<serde_json::Value>> = vec![None; names.len()];
    let mut got = 0usize;
    let mut line = String::new();
    for _ in 0..names.len() * 6 + 10 {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            break;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if let Some(rid) = v.get("request_id").and_then(|r| r.as_u64()) {
                let idx = rid.saturating_sub(1) as usize;
                if idx < out.len() && out[idx].is_none() {
                    let ok = v.get("error").and_then(|e| e.as_str()) == Some("success");
                    out[idx] = Some(if ok {
                        v.get("data").cloned().unwrap_or(serde_json::Value::Null)
                    } else {
                        serde_json::Value::Null
                    });
                    got += 1;
                    if got == names.len() {
                        break;
                    }
                }
            }
        }
    }
    Some(
        out.into_iter()
            .map(|v| v.unwrap_or(serde_json::Value::Null))
            .collect(),
    )
}

/// Asks a still-running mpv to exit (used after the finish was recorded so
/// `--keep-open` doesn't leave a parked window behind).
fn send_quit(pipe: &str) {
    use std::io::Write;
    if let Ok(mut stream) = std::fs::OpenOptions::new().write(true).open(pipe) {
        let _ = stream.write_all(b"{\"command\":[\"quit\"]}\n");
        let _ = stream.flush();
    }
}

/// IPC pipe of the external mpv instance this app launched, if any. Kept here
/// so closing the in-app player can also close the external window.
struct ActiveExternal {
    pipe: String,
    /// set when the app itself asked mpv to quit (switching stream, closing
    /// the player) — the watcher must not count that as "episode finished"
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

static ACTIVE_PIPE: std::sync::Mutex<Option<ActiveExternal>> = std::sync::Mutex::new(None);

/// Registers a freshly launched mpv and returns its cancellation flag.
pub fn register_external(pipe: &str) -> std::sync::Arc<std::sync::atomic::AtomicBool> {
    let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut g) = ACTIVE_PIPE.lock() {
        *g = Some(ActiveExternal {
            pipe: pipe.to_string(),
            cancelled: cancelled.clone(),
        });
    }
    cancelled
}

fn clear_active_pipe(pipe: &str) {
    if let Ok(mut g) = ACTIVE_PIPE.lock() {
        if g.as_ref().is_some_and(|a| a.pipe == pipe) {
            *g = None;
        }
    }
}

/// Asks the external mpv instance we launched (if still around) to quit.
pub fn quit_active() {
    let active = ACTIVE_PIPE.lock().ok().and_then(|mut g| g.take());
    if let Some(active) = active {
        active
            .cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        send_quit(&active.pipe);
    }
}

/// Watches a launched mpv instance over its IPC pipe. When playback reaches
/// the end (eof-reached), emits `mpv-finished` so the UI can bump progress for
/// the entry it was launched from, then closes mpv.
pub async fn watch_finish(
    app: tauri::AppHandle,
    pipe: String,
    entry_id: Option<i64>,
    episode: Option<i64>,
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(6 * 3600);
    let mut connected = false;
    let mut played = false;
    let mut misses = 0usize;
    let mut idle_before_play = 0usize;
    let emit_finished = || {
        if cancelled.load(Ordering::SeqCst) {
            return;
        }
        if let (Some(entry_id), Some(episode)) = (entry_id, episode) {
            app.emit(
                "mpv-finished",
                serde_json::json!({ "entryId": entry_id, "episode": episode }),
            )
            .ok();
        }
    };
    loop {
        if std::time::Instant::now() > deadline {
            send_quit(&pipe);
            clear_active_pipe(&pipe);
            return;
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let pipe2 = pipe.clone();
        let res = tokio::task::spawn_blocking(move || {
            query_props(&pipe2, &["eof-reached", "idle-active", "time-pos"])
        })
        .await
        .ok()
        .flatten();
        let Some(props) = res else {
            misses += 1;
            if connected && misses >= 2 {
                // our mpv went away: user closed it (X) or the process died.
                // if playback actually started, treat it as finished so the
                // episode is counted and the queue can advance.
                if played {
                    emit_finished();
                }
                clear_active_pipe(&pipe);
                return;
            }
            if !connected && misses >= 36 {
                // never came up (~3 min): wrong instance or mpv failed to start
                clear_active_pipe(&pipe);
                return;
            }
            continue;
        };
        connected = true;
        misses = 0;
        let eof = props.first().and_then(|v| v.as_bool()).unwrap_or(false);
        let idle = props.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
        let pos = props.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0);
        if pos > 10.0 {
            played = true;
        }
        if eof {
            emit_finished();
            send_quit(&pipe);
            clear_active_pipe(&pipe);
            return;
        }
        if !played && idle {
            // idle before playback ever started (dead magnet / load failure)
            idle_before_play += 1;
            if idle_before_play >= 24 {
                send_quit(&pipe);
                clear_active_pipe(&pipe);
                return;
            }
        } else {
            idle_before_play = 0;
        }
    }
}

pub fn verify_mpv(mpv_path: &str) -> Result<String, String> {
    let mut tries: Vec<String> = Vec::new();
    if !mpv_path.trim().is_empty() {
        tries.push(mpv_path.trim().to_string());
    }
    tries.push("mpv".to_string());
    tries.push("mpv.exe".to_string());
    for cand in tries {
        if let Ok(out) = Command::new(&cand).arg("--version").output() {
            if out.status.success() {
                let v = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").to_string();
                return Ok(v);
            }
        }
    }
    Err("mpv not found".into())
}