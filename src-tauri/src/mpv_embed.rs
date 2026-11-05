//! In-process mpv playback via libmpv-2.dll.
//!
//! The DLL is loaded at runtime (LoadLibrary), never linked at build time, so
//! the app builds and runs fine without it — when it is missing, playback
//! falls back to spawning the external mpv.exe against the rqbit HTTP stream.
//! Video renders into a plain Win32 child window placed over the webview,
//! leaving a bottom strip for the in-app control bar.

use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use serde_json::json;
use tauri::Emitter;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryW};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, FindWindowExW, GetCursorPos, GetParent, IsWindowVisible,
    KillTimer, LoadCursorW, MoveWindow, RegisterClassW, SetCursor, SetTimer, SetWindowPos,
    ShowWindow, WindowFromPoint, IDC_ARROW, WM_MOUSEMOVE, WM_SETCURSOR, WM_TIMER, WNDCLASSW,
    WS_CHILD, WS_VISIBLE,
};

// ---------------------------------------------------------------- mpv FFI

type MpvHandle = *mut c_void;

const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;

const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_LOG_MESSAGE: c_int = 2;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

const MPV_END_FILE_REASON_EOF: c_int = 0;
const MPV_END_FILE_REASON_ERROR: c_int = 4;

#[repr(C)]
struct MpvEvent {
    event_id: c_int,
    error: c_int,
    reply_userdata: u64,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventProperty {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct MpvEventEndFile {
    reason: c_int,
    error: c_int,
}

/// mpv_event_log_message — the strings are owned by mpv and only valid until
/// the next wait_event call, so copy them out immediately.
#[repr(C)]
struct MpvEventLogMessage {
    prefix: *const c_char,
    level: *const c_char,
    text: *const c_char,
    log_level: c_int,
}

pub struct MpvLib {
    _module: usize,
    pub create: unsafe extern "C" fn() -> MpvHandle,
    pub initialize: unsafe extern "C" fn(MpvHandle) -> c_int,
    pub terminate_destroy: unsafe extern "C" fn(MpvHandle),
    pub set_option_string: unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    pub command: unsafe extern "C" fn(MpvHandle, *mut *const c_char) -> c_int,
    pub get_property: unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int,
    pub set_property: unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int,
    pub observe_property:
        unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int,
    pub wait_event: unsafe extern "C" fn(MpvHandle, c_double) -> *mut c_void,
    /// mpv_free — only needed if we ever take ownership of strings via
    /// mpv_get_property(STRING); event data must never be freed (see the
    /// media-title handler below).
    #[allow(dead_code)]
    pub free: unsafe extern "C" fn(*mut c_void),
    pub request_log_messages: unsafe extern "C" fn(MpvHandle, *const c_char) -> c_int,
}

unsafe fn bind(module: usize, name: &[u8]) -> Result<*const c_void, String> {
    let sym = CString::new(&name[..name.len() - 1]).map_err(|_| "bad symbol name")?;
    let ptr = GetProcAddress(module as _, sym.as_ptr() as *const u8);
    ptr.map(|p| p as *const c_void).ok_or_else(|| {
        format!(
            "libmpv-2.dll is missing export {}",
            String::from_utf8_lossy(&name[..name.len() - 1])
        )
    })
}

macro_rules! sym {
    ($module:expr, $name:literal, $ty:ty) => {{
        let p = unsafe { bind($module, $name)? } as *const ();
        unsafe { std::mem::transmute::<*const (), $ty>(p) }
    }};
}

/// Loads libmpv-2.dll from the first existing candidate and binds the small
/// slice of the client API this app needs. Returns None when unavailable.
pub fn load_lib(extra_candidate: Option<&str>) -> Option<Arc<MpvLib>> {
    static CACHE: OnceLock<Option<Arc<MpvLib>>> = OnceLock::new();
    let hit = CACHE.get_or_init(|| try_load_lib(extra_candidate));
    hit.clone()
}

fn try_load_lib(extra_candidate: Option<&str>) -> Option<Arc<MpvLib>> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = extra_candidate {
        if !p.trim().is_empty() {
            candidates.push(p.trim().to_string());
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("libmpv-2.dll").to_string_lossy().to_string());
        }
    }
    candidates.push("libmpv-2.dll".to_string());
    candidates.push("E:\\mpv\\libmpv-2.dll".to_string());
    candidates.push("C:\\mpv\\libmpv-2.dll".to_string());

    let mut module: usize = 0;
    for c in &candidates {
        if c == "libmpv-2.dll" || std::path::Path::new(c).exists() {
            let wide: Vec<u16> = c.encode_utf16().chain(std::iter::once(0)).collect();
            let h = unsafe { LoadLibraryW(wide.as_ptr()) };
            log::info!("LoadLibrary(libmpv-2.dll from {c}) -> {}", if h != 0 { "ok" } else { "failed" });
            if h != 0 {
                module = h as usize;
                break;
            }
        }
    }
    if module == 0 {
        log::info!("libmpv-2.dll not found — built-in player unavailable");
        return None;
    }

    // bind every symbol we use; a single missing export means the DLL is too
    // old and the built-in player is disabled
    let bind_all = || -> Result<MpvLib, String> {
        Ok(MpvLib {
            _module: module,
            create: sym!(module, b"mpv_create\0", unsafe extern "C" fn() -> MpvHandle),
            initialize: sym!(module, b"mpv_initialize\0", unsafe extern "C" fn(MpvHandle) -> c_int),
            terminate_destroy: sym!(
                module,
                b"mpv_terminate_destroy\0",
                unsafe extern "C" fn(MpvHandle)
            ),
            set_option_string: sym!(
                module,
                b"mpv_set_option_string\0",
                unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int
            ),
            command: sym!(
                module,
                b"mpv_command\0",
                unsafe extern "C" fn(MpvHandle, *mut *const c_char) -> c_int
            ),
            get_property: sym!(
                module,
                b"mpv_get_property\0",
                unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int
            ),
            set_property: sym!(
                module,
                b"mpv_set_property\0",
                unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int
            ),
            observe_property: sym!(
                module,
                b"mpv_observe_property\0",
                unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int
            ),
            wait_event: sym!(
                module,
                b"mpv_wait_event\0",
                unsafe extern "C" fn(MpvHandle, c_double) -> *mut c_void
            ),
            free: sym!(module, b"mpv_free\0", unsafe extern "C" fn(*mut c_void)),
            request_log_messages: sym!(
                module,
                b"mpv_request_log_messages\0",
                unsafe extern "C" fn(MpvHandle, *const c_char) -> c_int
            ),
        })
    };
    match bind_all() {
        Ok(lib) => Some(Arc::new(lib)),
        Err(e) => {
            log::warn!("{e}");
            None
        }
    }
}

pub fn lib_available() -> bool {
    load_lib(None).is_some()
}

// ---------------------------------------------------------------- window

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The WebView2 content lives in a sibling child window of the main window
/// (class "WRY_WEBVIEW"). Overlapping sibling HWNDs compose by z-order and the
/// webview starts on top, hiding the video overlay. Push the webview directly
/// below the video window so playback stays visible.
fn lower_webview_below(parent: isize, video: isize) {
    unsafe {
        let cls = wide("WRY_WEBVIEW");
        let webview = FindWindowExW(parent as HWND, 0, cls.as_ptr(), std::ptr::null());
        if webview == 0 || webview as isize == video {
            return;
        }
        // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
        SetWindowPos(webview, video as HWND, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    }
}

// ---------------------------------------------------------- cursor autohide

// In --wid mode mpv disables its own child window, so it never receives mouse
// messages and its cursor-autohide logic never runs. Watch the cursor from the
// host video window instead: hide it after a short idle period and bring it
// back on the next movement. Only the video area is affected — over the webview
// bar the webview keeps controlling the cursor.

const CURSOR_TIMER_ID: usize = 0xE517;
const CURSOR_IDLE_MS: u64 = 1500;
const CURSOR_POLL_MS: u32 = 100;

static CURSOR_HIDDEN: AtomicBool = AtomicBool::new(false);
static CURSOR_LAST_POS: AtomicU64 = AtomicU64::new(u64::MAX);
static CURSOR_LAST_MOVE_MS: AtomicU64 = AtomicU64::new(0);
static CURSOR_EPOCH: OnceLock<Instant> = OnceLock::new();

fn cursor_now_ms() -> u64 {
    CURSOR_EPOCH
        .get_or_init(Instant::now)
        .elapsed()
        .as_millis() as u64
}

fn cursor_pos_bits(pt: &POINT) -> u64 {
    ((pt.x as u32 as u64) << 32) | (pt.y as u32 as u64)
}

/// True when the cursor is over the video surface (or mpv's disabled child
/// window inside it), not over the webview or another window.
unsafe fn cursor_over_video(hwnd: HWND) -> bool {
    let mut pt = POINT { x: 0, y: 0 };
    if GetCursorPos(&mut pt) == 0 {
        return false;
    }
    let mut w = WindowFromPoint(pt);
    while w != 0 {
        if w == hwnd {
            return true;
        }
        w = GetParent(w);
    }
    false
}

unsafe fn cursor_show() {
    if CURSOR_HIDDEN.swap(false, Ordering::Relaxed) {
        SetCursor(LoadCursorW(0, IDC_ARROW));
    }
}

unsafe fn cursor_hide() {
    CURSOR_HIDDEN.store(true, Ordering::Relaxed);
    SetCursor(0);
}

fn start_cursor_watch(hwnd: isize) {
    unsafe {
        CURSOR_HIDDEN.store(false, Ordering::Relaxed);
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) != 0 {
            CURSOR_LAST_POS.store(cursor_pos_bits(&pt), Ordering::Relaxed);
        }
        CURSOR_LAST_MOVE_MS.store(cursor_now_ms(), Ordering::Relaxed);
        SetCursor(LoadCursorW(0, IDC_ARROW));
        SetTimer(hwnd as HWND, CURSOR_TIMER_ID, CURSOR_POLL_MS, None);
    }
}

fn stop_cursor_watch(hwnd: isize) {
    unsafe {
        KillTimer(hwnd as HWND, CURSOR_TIMER_ID);
        if CURSOR_HIDDEN.swap(false, Ordering::Relaxed) {
            SetCursor(LoadCursorW(0, IDC_ARROW));
        }
        CURSOR_LAST_POS.store(u64::MAX, Ordering::Relaxed);
    }
}

unsafe extern "system" fn video_wndproc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_MOUSEMOVE => {
            // Windows sends spurious moves on unrelated events; only a real
            // position change should bring the cursor back and reset the timer
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) != 0 {
                let bits = cursor_pos_bits(&pt);
                if CURSOR_LAST_POS.swap(bits, Ordering::Relaxed) != bits {
                    CURSOR_LAST_MOVE_MS.store(cursor_now_ms(), Ordering::Relaxed);
                    cursor_show();
                }
            }
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
        WM_SETCURSOR => {
            // keep the pointer hidden until the watcher notices movement
            if CURSOR_HIDDEN.load(Ordering::Relaxed) {
                SetCursor(0);
                1
            } else {
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }
        WM_TIMER if wparam == CURSOR_TIMER_ID => {
            if IsWindowVisible(hwnd) == 0 {
                CURSOR_HIDDEN.store(false, Ordering::Relaxed);
                return 0;
            }
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) == 0 {
                return 0;
            }
            let bits = cursor_pos_bits(&pt);
            let now = cursor_now_ms();
            if CURSOR_LAST_POS.swap(bits, Ordering::Relaxed) != bits {
                CURSOR_LAST_MOVE_MS.store(now, Ordering::Relaxed);
                cursor_show();
            } else if !CURSOR_HIDDEN.load(Ordering::Relaxed)
                && now.saturating_sub(CURSOR_LAST_MOVE_MS.load(Ordering::Relaxed)) >= CURSOR_IDLE_MS
                && cursor_over_video(hwnd)
            {
                cursor_hide();
            }
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Creates (once) a black child window of the given parent that mpv renders
/// into. Reused across playbacks.
fn video_hwnd(parent: isize) -> Result<isize, String> {
    static HWND: OnceLock<isize> = OnceLock::new();
    if let Some(h) = HWND.get() {
        return Ok(*h);
    }
    unsafe {
        let class_name = wide("estenyac_video");
        let hinstance = GetModuleHandleW(std::ptr::null());
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(video_wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: 0,
            hCursor: 0,
            hbrBackground: GetStockObject(BLACK_BRUSH as i32),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        let _ = RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            std::ptr::null(),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            640,
            360,
            parent,
            0,
            hinstance,
            std::ptr::null(),
        );
        if hwnd == 0 {
            return Err("could not create the video window".into());
        }
        let _ = HWND.set(hwnd);
        HWND.get().copied().ok_or_else(|| "video window missing".into())
    }
}

// ---------------------------------------------------------------- player

/// Playback context shared with the event thread; updated on every load().
#[derive(Clone, Default)]
struct PlaybackCtx {
    title: Option<String>,
    entry_id: Option<i64>,
    episode: Option<i64>,
}

#[derive(Clone, serde::Serialize)]
pub struct TrackInfo {
    pub id: i64,
    #[serde(rename = "type")]
    pub track_type: String,
    pub lang: Option<String>,
    pub title: Option<String>,
    pub codec: Option<String>,
    pub selected: bool,
    pub default: bool,
    pub external: bool,
}

fn get_property_string(lib: &MpvLib, handle: MpvHandle, name: &str) -> Option<String> {
    let key = CString::new(name).ok()?;
    let mut ptr: *mut c_char = std::ptr::null_mut();
    unsafe {
        if (lib.get_property)(
            handle,
            key.as_ptr(),
            MPV_FORMAT_STRING,
            &mut ptr as *mut *mut c_char as *mut c_void,
        ) < 0
            || ptr.is_null()
        {
            return None;
        }
        let value = CStr::from_ptr(ptr).to_string_lossy().into_owned();
        (lib.free)(ptr as *mut c_void);
        Some(value)
    }
}

fn get_property_i64(lib: &MpvLib, handle: MpvHandle, name: &str) -> Option<i64> {
    let key = CString::new(name).ok()?;
    let mut value: i64 = 0;
    unsafe {
        if (lib.get_property)(
            handle,
            key.as_ptr(),
            MPV_FORMAT_INT64,
            &mut value as *mut i64 as *mut c_void,
        ) < 0
        {
            return None;
        }
    }
    Some(value)
}

fn get_property_flag(lib: &MpvLib, handle: MpvHandle, name: &str) -> bool {
    let Ok(key) = CString::new(name) else {
        return false;
    };
    let mut value: c_int = 0;
    unsafe {
        (lib.get_property)(
            handle,
            key.as_ptr(),
            MPV_FORMAT_FLAG,
            &mut value as *mut c_int as *mut c_void,
        ) >= 0
            && value != 0
    }
}

/// Reads mpv's current audio and subtitle track list. Indexed properties keep
/// this independent of the node/map FFI types and their ownership rules.
fn read_tracks(lib: &MpvLib, handle: MpvHandle) -> Vec<TrackInfo> {
    let count = get_property_i64(lib, handle, "track-list/count")
        .unwrap_or(0)
        .max(0);
    let mut tracks = Vec::new();
    for i in 0..count {
        let Some(id) = get_property_i64(lib, handle, &format!("track-list/{i}/id")) else {
            continue;
        };
        let track_type = get_property_string(lib, handle, &format!("track-list/{i}/type"))
            .unwrap_or_default();
        if track_type != "audio" && track_type != "sub" {
            continue;
        }
        tracks.push(TrackInfo {
            id,
            track_type,
            lang: get_property_string(lib, handle, &format!("track-list/{i}/lang")),
            title: get_property_string(lib, handle, &format!("track-list/{i}/title")),
            codec: get_property_string(lib, handle, &format!("track-list/{i}/codec")),
            selected: get_property_flag(lib, handle, &format!("track-list/{i}/selected")),
            default: get_property_flag(lib, handle, &format!("track-list/{i}/default")),
            external: get_property_flag(lib, handle, &format!("track-list/{i}/external")),
        });
    }
    tracks
}

pub struct EmbeddedPlayer {
    lib: Arc<MpvLib>,
    handle: MpvHandle,
    hwnd: isize,
    ctx: Arc<Mutex<PlaybackCtx>>,
}

unsafe impl Send for EmbeddedPlayer {}
unsafe impl Sync for EmbeddedPlayer {}

static PLAYER: Mutex<Option<Arc<EmbeddedPlayer>>> = Mutex::new(None);

pub fn current_player() -> Option<Arc<EmbeddedPlayer>> {
    PLAYER.lock().ok()?.clone()
}

impl EmbeddedPlayer {
    /// Creates or returns the existing in-process player for this app run.
    pub fn get_or_create(parent_hwnd: isize, app: tauri::AppHandle) -> Result<Arc<EmbeddedPlayer>, String> {
        let mut guard = PLAYER.lock().map_err(|_| "player lock poisoned")?;
        if let Some(p) = guard.as_ref() {
            return Ok(p.clone());
        }
        let Some(lib) = load_lib(None) else {
            return Err("libmpv-2.dll not found".into());
        };
        let hwnd = video_hwnd(parent_hwnd)?;
        lower_webview_below(parent_hwnd, hwnd);
        unsafe {
            log::info!("mpv: creating instance (video hwnd {hwnd:x})");
            let handle = (lib.create)();
            if handle.is_null() {
                log::warn!("mpv_create returned null");
                return Err("mpv_create failed".into());
            }
            let opts = [
                ("wid", hwnd.to_string()),
                ("config", "no".into()),
                ("terminal", "no".into()),
                ("osc", "no".into()),
                ("input-default-bindings", "no".into()),
                ("input-vo-keyboard", "no".into()),
                ("ytdl", "no".into()),
                ("hwdec", "auto-safe".into()),
                // modest demuxer read-ahead: enough to ride out short gaps in
                // the torrent HTTP stream without duplicating the whole file in
                // mpv's own cache on top of the storage layer
                ("demuxer-max-bytes", "48MiB".into()),
                ("demuxer-max-back-bytes", "24MiB".into()),
                ("keep-open", "yes".into()),
                ("force-window", "yes".into()),
                ("idle", "yes".into()),
                ("volume", "60".into()),
            ];
            for (k, v) in &opts {
                let k = CString::new(*k).unwrap();
                let v = CString::new(v.as_str()).unwrap();
                if (lib.set_option_string)(handle, k.as_ptr(), v.as_ptr()) < 0 {
                    log::warn!("mpv rejected option {k:?}");
                    (lib.terminate_destroy)(handle);
                    return Err(format!("mpv rejected option {k:?}"));
                }
            }
            log::info!("mpv: options set, initializing core");
            if (lib.initialize)(handle) < 0 {
                log::warn!("mpv_initialize failed");
                (lib.terminate_destroy)(handle);
                return Err("mpv_initialize failed".into());
            }
            log::info!("mpv: core initialized");
            // observed properties drive the in-app control bar
            for (id, name, fmt) in [
                (1u64, "time-pos", MPV_FORMAT_DOUBLE),
                (2, "duration", MPV_FORMAT_DOUBLE),
                (3, "pause", MPV_FORMAT_FLAG),
                (4, "media-title", MPV_FORMAT_STRING),
                (5, "idle-active", MPV_FORMAT_FLAG),
                // with keep-open=yes mpv parks at the last frame instead of
                // unloading the file, so no end-file event arrives at natural
                // EOF; this property is the only reliable end-of-episode signal
                (6, "eof-reached", MPV_FORMAT_FLAG),
            ] {
                let n = CString::new(name).unwrap();
                (lib.observe_property)(handle, id, n.as_ptr(), fmt);
            }
            let _ = (lib.request_log_messages)(handle, CString::new("info").unwrap().as_ptr());

            let ctx = Arc::new(Mutex::new(PlaybackCtx::default()));
            spawn_event_thread(lib.clone(), handle as usize, ctx.clone(), app);
            let player = Arc::new(EmbeddedPlayer { lib, handle, hwnd, ctx });
            *guard = Some(player.clone());
            log::info!("mpv: instance ready, event thread running");
            Ok(player)
        }
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let cargs: Vec<CString> = args
            .iter()
            .map(|a| CString::new(*a).map_err(|_| "bad command arg".to_string()))
            .collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = cargs.iter().map(|c| c.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        unsafe {
            if (self.lib.command)(self.handle, ptrs.as_mut_ptr()) < 0 {
                return Err(format!("mpv command {:?} failed", args.first().unwrap_or(&"")));
            }
        }
        Ok(())
    }

    /// Resets manual track picks and applies the user's preferred language
    /// tags before a file is loaded. Empty values clear the preference so mpv
    /// uses the file's own defaults. Resetting aid/sid keeps a choice made for
    /// one episode from leaking into the next one on the reused player.
    pub fn apply_track_prefs(&self, audio: &str, subtitles: &str) {
        for (name, value) in [
            ("aid", "auto"),
            ("sid", "auto"),
            ("alang", audio),
            ("slang", subtitles),
        ] {
            if let Err(e) = self.command(&["set", name, value]) {
                log::warn!("mpv: could not set {name}: {e}");
            }
        }
    }

    pub fn tracks(&self) -> Vec<TrackInfo> {
        read_tracks(&self.lib, self.handle)
    }

    pub fn set_audio_track(&self, id: Option<i64>) -> Result<(), String> {
        match id {
            Some(id) => self.command(&["set", "aid", &id.to_string()]),
            None => self.command(&["set", "aid", "auto"]),
        }
    }

    pub fn set_subtitle_track(&self, id: Option<i64>, auto: bool) -> Result<(), String> {
        if auto {
            return self.command(&["set", "sid", "auto"]);
        }
        match id {
            Some(id) => self.command(&["set", "sid", &id.to_string()]),
            None => self.command(&["set", "sid", "no"]),
        }
    }

    pub fn load(
        &self,
        url: &str,
        title: Option<String>,
        entry_id: Option<i64>,
        episode: Option<i64>,
    ) -> Result<(), String> {
        let prev = self.ctx.lock().ok().map(|mut ctx| {
            let prev = ctx.clone();
            *ctx = PlaybackCtx { title, entry_id, episode };
            prev
        });
        log::info!("mpv: loadfile {url}");
        if let Err(e) = self.command(&["loadfile", url, "replace"]) {
            // the stream never started; keep the previous context so late
            // events can't be attributed to the failed load
            if let (Some(prev), Ok(mut ctx)) = (prev, self.ctx.lock()) {
                *ctx = prev;
            }
            log::warn!("mpv: {e}");
            return Err(e);
        }
        log::info!("mpv: loadfile accepted");
        unsafe {
            ShowWindow(self.hwnd as HWND, 5); // SW_SHOW
        }
        start_cursor_watch(self.hwnd);
        Ok(())
    }

    pub fn toggle_pause(&self) -> Result<(), String> {
        self.set_paused(!self.is_paused())
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        let mut v: c_int = paused as c_int;
        let name = CString::new("pause").unwrap();
        unsafe {
            if (self.lib.set_property)(self.handle, name.as_ptr(), MPV_FORMAT_FLAG, &mut v as *mut c_int as *mut c_void) < 0 {
                return Err("could not set pause".into());
            }
        }
        Ok(())
    }

    pub fn is_paused(&self) -> bool {
        let mut v: c_int = 0;
        let name = CString::new("pause").unwrap();
        unsafe {
            if (self.lib.get_property)(self.handle, name.as_ptr(), MPV_FORMAT_FLAG, &mut v as *mut c_int as *mut c_void) < 0 {
                return false;
            }
        }
        v != 0
    }

    pub fn seek_abs(&self, seconds: f64) {
        let _ = self.command(&["seek", &format!("{seconds:.3}"), "absolute"]);
    }

    pub fn seek_rel(&self, seconds: f64) {
        let _ = self.command(&["seek", &format!("{seconds:.3}"), "relative"]);
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        let mut v = volume.clamp(0.0, 130.0);
        let name = CString::new("volume").unwrap();
        unsafe {
            if (self.lib.set_property)(self.handle, name.as_ptr(), MPV_FORMAT_DOUBLE, &mut v as *mut f64 as *mut c_void) < 0 {
                return Err("could not set volume".into());
            }
        }
        Ok(())
    }

    pub fn set_area(&self, x: i32, y: i32, w: i32, h: i32) {
        unsafe {
            MoveWindow(self.hwnd as HWND, x, y, w.max(0), h.max(0), 1);
        }
    }

    /// Stops playback and hides the overlay. The mpv instance stays alive for
    /// the next load().
    pub fn stop_and_hide(&self) {
        let _ = self.command(&["stop"]);
        stop_cursor_watch(self.hwnd);
        unsafe {
            ShowWindow(self.hwnd as HWND, 0); // SW_HIDE
        }
    }
}

fn spawn_event_thread(
    lib: Arc<MpvLib>,
    handle: usize,
    ctx: Arc<Mutex<PlaybackCtx>>,
    app: tauri::AppHandle,
) {
    let snapshot = |ctx: &Arc<Mutex<PlaybackCtx>>| -> PlaybackCtx {
        let guard = ctx.lock().ok();
        match guard.as_deref() {
            Some(c) => c.clone(),
            None => PlaybackCtx::default(),
        }
    };
    std::thread::spawn(move || {
        let handle = handle as MpvHandle;
        let mut time_pos: f64 = 0.0;
        let mut duration: f64 = 0.0;
        let mut paused = false;
        let mut idle = true;
        let mut eof = false;
        let mut loaded = false;
        let mut finish_notified = false;
        let mut title: Option<String> = None;
        let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
        loop {
            let ev = unsafe { (lib.wait_event)(handle, 0.25) };
            if ev.is_null() {
                continue;
            }
            let e = unsafe { &*(ev as *const MpvEvent) };
            match e.event_id {
                MPV_EVENT_PROPERTY_CHANGE => {
                    if e.data.is_null() {
                        continue;
                    }
                    let p = unsafe { &*(e.data as *const MpvEventProperty) };
                    if p.name.is_null() {
                        continue;
                    }
                    let name = unsafe { CStr::from_ptr(p.name) }
                        .to_string_lossy()
                        .to_string();
                    match name.as_str() {
                        "time-pos" if p.format == MPV_FORMAT_DOUBLE => {
                            if !p.data.is_null() {
                                time_pos = unsafe { *(p.data as *const f64) };
                            }
                        }
                        "duration" if p.format == MPV_FORMAT_DOUBLE => {
                            if !p.data.is_null() {
                                duration = unsafe { *(p.data as *const f64) };
                            }
                        }
                        "pause" if p.format == MPV_FORMAT_FLAG => {
                            if !p.data.is_null() {
                                paused = unsafe { *(p.data as *const c_int) } != 0;
                            }
                        }
                        "idle-active" if p.format == MPV_FORMAT_FLAG => {
                            if !p.data.is_null() {
                                idle = unsafe { *(p.data as *const c_int) } != 0;
                            }
                        }
                        "eof-reached" if p.format == MPV_FORMAT_FLAG => {
                            if !p.data.is_null() {
                                eof = unsafe { *(p.data as *const c_int) } != 0;
                            }
                        }
                        "media-title" if p.format == MPV_FORMAT_STRING => {
                            // property-change events hand us mpv-owned data that
                            // stays valid only until the next wait_event call —
                            // for STRING it's a char** slot, copy it and never
                            // mpv_free it (freeing corrupts the heap and takes
                            // the process down inside free())
                            if !p.data.is_null() {
                                let s = unsafe {
                                    *(p.data as *const *const c_char)
                                };
                                if !s.is_null() {
                                    title = Some(
                                        unsafe { CStr::from_ptr(s) }
                                            .to_string_lossy()
                                            .to_string(),
                                    );
                                }
                            }
                        }
                        _ => continue,
                    }
                    // time-pos updates are throttled to 10 Hz, but discrete
                    // state changes must never be swallowed: when playback is
                    // paused, time-pos stops changing, so a dropped "pause"
                    // event would leave the control bar on a stale icon until
                    // something else happened.
                    let immediate = matches!(
                        name.as_str(),
                        "pause" | "idle-active" | "duration" | "media-title"
                    );
                    if immediate || last_emit.elapsed().as_millis() >= 100 {
                        last_emit = std::time::Instant::now();
                        let c = snapshot(&ctx);
                        app.emit(
                            "player-state",
                            json!({
                                "timePos": time_pos,
                                "duration": duration,
                                "paused": paused,
                                "idle": idle,
                                "title": c.title.or(title.clone()),
                                "entryId": c.entry_id,
                                "episode": c.episode,
                            }),
                        )
                        .ok();
                    }
                    // keep-open parks at the last frame, so watch for the
                    // property flip rather than waiting for end-file; ignore
                    // the value mpv reports before any file has loaded
                    if eof && loaded && !finish_notified {
                        finish_notified = true;
                        let c = snapshot(&ctx);
                        log::info!(
                            "mpv: eof reached (entry {:?}, episode {:?})",
                            c.entry_id,
                            c.episode
                        );
                        app.emit(
                            "player-finished",
                            json!({ "entryId": c.entry_id, "episode": c.episode }),
                        )
                        .ok();
                    } else if !eof {
                        finish_notified = false;
                    }
                }
                MPV_EVENT_LOG_MESSAGE => {
                    if e.data.is_null() {
                        continue;
                    }
                    let m = unsafe { &*(e.data as *const MpvEventLogMessage) };
                    let fmt = |p: *const c_char| -> String {
                        if p.is_null() {
                            String::new()
                        } else {
                            unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
                        }
                    };
                    let text = fmt(m.text);
                    for line in text.lines() {
                        if line.is_empty() {
                            continue;
                        }
                        let level = fmt(m.level);
                        let prefix = fmt(m.prefix);
                        let msg = format!("mpv[{prefix}] {line}");
                        match level.as_str() {
                            "fatal" | "error" => log::error!("{msg}"),
                            "warn" => log::warn!("{msg}"),
                            _ => log::info!("{msg}"),
                        }
                    }
                }
                MPV_EVENT_FILE_LOADED => {
                    log::info!("mpv: file loaded, playback starting");
                    eof = false;
                    loaded = true;
                    finish_notified = false;
                    // the previous file's position is meaningless now, and a
                    // new load may keep mpv paused
                    time_pos = 0.0;
                    duration = 0.0;
                    let c = snapshot(&ctx);
                    app.emit(
                        "player-state",
                        json!({
                            "timePos": 0.0, "duration": 0.0, "paused": paused, "idle": false,
                            "title": c.title, "entryId": c.entry_id, "episode": c.episode,
                        }),
                    )
                    .ok();
                    app.emit(
                        "player-tracks",
                        json!({ "tracks": read_tracks(&lib, handle) }),
                    )
                    .ok();
                }
                MPV_EVENT_END_FILE => {
                    log::info!("mpv: end-file (reason {}, error {})", {
                        let p = if e.data.is_null() { None } else {
                            Some(unsafe { &*(e.data as *const MpvEventEndFile) })
                        };
                        p.map(|p| p.reason).unwrap_or(-1)
                    }, e.error);
                    if !e.data.is_null() {
                        let p = unsafe { &*(e.data as *const MpvEventEndFile) };
                        if p.reason == MPV_END_FILE_REASON_EOF {
                            if !finish_notified {
                                finish_notified = true;
                                let c = snapshot(&ctx);
                                app.emit(
                                    "player-finished",
                                    json!({ "entryId": c.entry_id, "episode": c.episode }),
                                )
                                .ok();
                            }
                        } else if p.reason == MPV_END_FILE_REASON_ERROR {
                            app.emit(
                                "player-error",
                                json!({ "message": format!("playback failed (code {})", e.error) }),
                            )
                            .ok();
                        }
                    }
                    // the file is gone until the next loadfile; don't let a
                    // stale eof-reached reading look like a finished episode
                    loaded = false;
                }
                MPV_EVENT_SHUTDOWN => {
                    log::info!("mpv: core shutdown");
                    break;
                }
                _ => {}
            }
        }
        unsafe { (lib.terminate_destroy)(handle) };
    });
}

/// Repositions the overlay to cover the whole window client area minus the
/// bottom control bar (h-14 = 56 CSS px, scaled). Also re-asserts the video
/// window's z-order above the WebView2 sibling.
pub fn layout_for_window(window: &tauri::WebviewWindow) {
    let Some(player) = current_player() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(size) = window.inner_size() else { return };
    let bar = (56.0 * scale).round() as i32;
    player.set_area(0, 0, size.width as i32, size.height as i32 - bar);
    if let Ok(h) = window.hwnd() {
        lower_webview_below(h.0 as isize, player.hwnd);
    }
}
