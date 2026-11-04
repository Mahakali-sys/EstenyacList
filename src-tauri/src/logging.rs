//! File logging: appends every `log::` line to <exe dir>\logs\estenyac.log and
//! installs a panic hook that records panics the same way. Without this the
//! log macros were compiled in but went nowhere, so native playback failures
//! died silently.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;

struct FileLogger {
    path: PathBuf,
    file: Mutex<Option<std::fs::File>>,
}

impl log::Log for FileLogger {
    fn enabled(&self, meta: &log::Metadata) -> bool {
        meta.level() <= log::Level::Info
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let mut guard = self.file.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            *guard = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .ok();
        }
        if let Some(f) = guard.as_mut() {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let tid = std::thread::current().id();
            let _ = writeln!(
                f,
                "{ts} [{tid:?}] {:<5} [{}] {}",
                record.level(),
                record.target(),
                record.args()
            );
        }
    }

    fn flush(&self) {
        if let Some(f) = self.file.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            let _ = f.flush();
        }
    }
}

pub fn install() {
    let dir = crate::db::exe_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("estenyac.log");

    // keep the file from growing forever across sessions
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = std::fs::remove_file(&path);
        }
    }

    let logger: &'static FileLogger = Box::leak(Box::new(FileLogger {
        path: path.clone(),
        file: Mutex::new(None),
    }));
    let _ = log::set_logger(logger);
    log::set_max_level(log::LevelFilter::Info);

    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("PANIC [{:?}]: {}", std::thread::current().id(), info);
        log::error!("PANIC [{:?}]: {}", std::thread::current().id(), info);
        prev(info);
    }));

    log::info!("app starting, logging to {}", path.display());
}
