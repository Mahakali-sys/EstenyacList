use crate::db::Db;
use base64::Engine;
use std::io::Cursor;
use std::path::PathBuf;

const MAX_COVER_BYTES: usize = 4 * 1024 * 1024;
// Quality on the libjpeg-like 0..=100 scale used for the cached JXL covers.
const JXL_QUALITY: f32 = 95.0;
// Settings key remembering the quality the cache was encoded with; when the
// constant changes, existing covers are re-encoded on the next startup.
const QUALITY_SETTING: &str = "cover_jxl_quality";
// Covers are re-encoded to JPEG (for the webview) when served; do it at high
// quality so the second lossy generation stays visually identical.
const JPEG_REENCODE_QUALITY: u8 = 92;

pub fn file_for(id: i64) -> PathBuf {
    crate::db::cache_dir().join(format!("{id}.jxl"))
}

fn legacy_file_for(id: i64) -> PathBuf {
    crate::db::cache_dir().join(format!("{id}.jpg"))
}

pub fn delete_cache() -> std::io::Result<()> {
    let dir = crate::db::cache_dir();
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

fn is_jxl(bytes: &[u8]) -> bool {
    // bare codestream: 0xFF 0x0A
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0x0A {
        return true;
    }
    // ISOBMFF container: ...."JXL "
    bytes.len() >= 12 && &bytes[4..8] == b"JXL "
}

// Decodes a JPEG into interleaved RGB (width, height, pixels).
fn jpeg_to_rgb(jpeg: &[u8]) -> Option<(usize, usize, Vec<u8>)> {
    use zune_jpeg::zune_core::bytestream::ZCursor;
    use zune_jpeg::zune_core::colorspace::ColorSpace;
    use zune_jpeg::zune_core::options::DecoderOptions;
    use zune_jpeg::JpegDecoder;

    let options =
        DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::RGB);
    let mut decoder = JpegDecoder::new_with_options(ZCursor::new(jpeg), options);
    let pixels = decoder.decode().ok()?;
    let info = decoder.info()?;
    let width = info.width as usize;
    let height = info.height as usize;
    if width == 0 || height == 0 || pixels.len() < width * height * 3 {
        return None;
    }
    Some((width, height, pixels))
}

// Re-encodes pixel data as JPEG XL at the configured quality.
fn encode_jxl(width: usize, height: usize, rgb: &[u8]) -> Option<Vec<u8>> {
    let config = jixel::EncodeConfig::default().with_quality(JXL_QUALITY);
    jixel::encode_image(rgb, width, height, &config).ok()
}

// Converts cached JPEG bytes into a .jxl file. Returns the new path on success.
fn store_jpeg_as_jxl(db: &Db, anilist_id: i64, jpeg: &[u8]) -> Option<String> {
    let (width, height, rgb) = jpeg_to_rgb(jpeg)?;
    let jxl = encode_jxl(width, height, &rgb)?;
    let file = file_for(anilist_id);
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&file, &jxl).ok()?;
    // original no longer needed once the JXL is on disk
    let _ = std::fs::remove_file(legacy_file_for(anilist_id));
    let path = file.to_string_lossy().to_string();
    db.media_set_cover_file(anilist_id, &path);
    Some(path)
}

// Converts a legacy cached .jpg over to .jxl. Ok(true) = converted,
// Ok(false) = nothing to do, Err(reason) = failed and will be retried.
fn convert_legacy(db: &Db, anilist_id: i64) -> Result<bool, String> {
    let jxl = file_for(anilist_id);
    let legacy = legacy_file_for(anilist_id);
    if jxl.exists() {
        let _ = std::fs::remove_file(&legacy);
        return Ok(false);
    }
    if !legacy.exists() {
        return Ok(false);
    }
    let bytes =
        std::fs::read(&legacy).map_err(|e| format!("cannot read file: {e}"))?;
    if is_jxl(&bytes) {
        let _ = std::fs::rename(&legacy, &jxl);
        let path = jxl.to_string_lossy().to_string();
        db.media_set_cover_file(anilist_id, &path);
        return Ok(true);
    }
    let (width, height, rgb) = jpeg_to_rgb(&bytes)
        .ok_or_else(|| "not a decodable JPEG (non-JPEG bytes stored via fallback, or corrupt file)".to_string())?;
    let jxl_bytes = encode_jxl(width, height, &rgb)
        .ok_or_else(|| "JXL encoder rejected the image".to_string())?;
    if let Some(dir) = jxl.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(&jxl, &jxl_bytes)
        .map_err(|e| format!("cannot write .jxl: {e}"))?;
    let _ = std::fs::remove_file(&legacy);
    let path = jxl.to_string_lossy().to_string();
    db.media_set_cover_file(anilist_id, &path);
    Ok(true)
}

// One-time-ish migration: converts every cached .jpg cover to JPEG XL.
// Runs on every startup, so anything that failed (or was interrupted)
// is retried automatically.
pub fn migrate_legacy_covers(db: &Db) {
    let dir = crate::db::cache_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut converted = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("jpg")
        {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(anilist_id) = stem.parse::<i64>() else {
            continue;
        };
        if file_for(anilist_id).exists() {
            let _ = std::fs::remove_file(&path);
            skipped += 1;
            continue;
        }
        let start = std::time::Instant::now();
        match convert_legacy(db, anilist_id) {
            Ok(true) => {
                converted += 1;
                crate::db::append_log(&format!(
                    "cover {anilist_id}: jpg -> jxl in {:?}",
                    start.elapsed()
                ));
            }
            Ok(false) => {}
            Err(reason) => {
                failed += 1;
                crate::db::append_log(&format!(
                    "cover {anilist_id}: conversion failed - {reason}"
                ));
            }
        }
    }
    if converted > 0 || failed > 0 {
        crate::db::append_log(&format!(
            "cover migration: {converted} converted, {skipped} already done, {failed} failed (failed ones retry next launch)"
        ));
    }
}

// Shared client so every cover fetch reuses the same connection pool.
pub fn http_client() -> Option<&'static reqwest::Client> {
    static CLIENT: std::sync::OnceLock<Option<reqwest::Client>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent("EstenyacList/0.1")
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .ok()
        })
        .as_ref()
}

// Downloads a cover at a decent resolution (AniList "large" ~ 230px wide, ~30-60KB).
// Kept below "extraLarge" to avoid downloading/requesting unnecessary data.
pub async fn ensure_cover(db: &Db, anilist_id: i64, cover_url: Option<&str>) -> String {
    let file = file_for(anilist_id);
    if file.exists() {
        return file.to_string_lossy().to_string();
    }
    let Some(url) = cover_url else { return String::new() };
    if url.is_empty() {
        return String::new();
    }
    let Some(client) = http_client() else {
        return String::new();
    };
    if let Some(bytes) = fetch_bytes(client, url).await {
        if let Some(path) = store_cover_bytes(db, anilist_id, &bytes) {
            return path;
        }
    }
    String::new()
}

pub async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let is_image = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|ct| ct.to_str().ok())
        .map(|ct| ct.starts_with("image/"))
        .unwrap_or(true);
    let ok_len = resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|l| l.to_str().ok())
        .and_then(|l| l.parse::<usize>().ok())
        .map(|n| n <= MAX_COVER_BYTES)
        .unwrap_or(true);
    if !is_image || !ok_len {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_COVER_BYTES {
        return None;
    }
    Some(bytes.to_vec())
}

// Runs after a quality change: re-encodes every cached cover at the current
// JXL_QUALITY. Pristine pixels are preferred - the cover is re-downloaded
// from the AniList CDN (plain GET, no API rate limits) so the old quality's
// lossy generation doesn't linger. Offline, the existing pixels are reused.
pub async fn reencode_covers_for_quality(db: std::sync::Arc<Db>) {
    let saved = db
        .settings_get(QUALITY_SETTING)
        .and_then(|v| v.as_f64())
        .map(|q| (q as f32 - JXL_QUALITY).abs() < 0.001);
    if saved == Some(true) {
        return;
    }
    let dir = crate::db::cache_dir();
    let ids: Vec<i64> = match std::fs::read_dir(&dir) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("jxl") {
                    p.file_stem()
                        .and_then(|s| s.to_str())
                        .and_then(|s| s.parse::<i64>().ok())
                } else {
                    None
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    db.settings_set(QUALITY_SETTING, &serde_json::json!(JXL_QUALITY as f64));
    if ids.is_empty() {
        return;
    }
    crate::db::append_log(&format!(
        "cover quality change -> re-encoding {} covers at JXL quality {}",
        ids.len(),
        JXL_QUALITY
    ));
    let Some(client) = http_client() else {
        return;
    };
    let mut done = 0usize;
    for id in &ids {
        let fresh = match db
            .media_get(*id)
            .and_then(|m| {
                m.get("coverUrl")
                    .and_then(|u| u.as_str())
                    .map(|s| s.to_string())
            })
            .filter(|u| !u.is_empty())
        {
            Some(url) => {
                fetch_bytes(client, &url)
                    .await
                    .and_then(|bytes| jpeg_to_rgb(&bytes))
            }
            None => None,
        };
        let encoded = match fresh {
            Some((w, h, rgb)) => encode_jxl(w, h, &rgb),
            None => {
                // fallback: current pixels, no additional quality loss beyond q80
                let path = file_for(*id);
                std::fs::read(&path).ok().and_then(|b| {
                    jxl_to_rgb(&b).and_then(|(w, h, rgb)| encode_jxl(w, h, &rgb))
                })
            }
        };
        if let Some(data) = encoded {
            // temp + rename so a cover is never read half-written
            let target = file_for(*id);
            let tmp = target.with_extension("jxl.tmp");
            if std::fs::write(&tmp, &data).is_ok() && std::fs::rename(&tmp, &target).is_ok()
            {
                done += 1;
            }
        }
    }
    crate::db::append_log(&format!(
        "cover re-encode done: {done}/{} at JXL quality {JXL_QUALITY}",
        ids.len()
    ));
}

// Writes through a temp file + rename so the webview never reads a
// half-written cover while it is being cached.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> bool {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    if std::fs::write(&tmp, bytes).is_ok() && std::fs::rename(&tmp, path).is_ok() {
        true
    } else {
        let _ = std::fs::remove_file(&tmp);
        false
    }
}

// Stores downloaded cover bytes: JPEG -> .jxl (preferred), JXL -> .jxl as-is,
// anything else (e.g. PNG) -> legacy .jpg so it can still be served.
pub fn store_cover_bytes(db: &Db, anilist_id: i64, bytes: &[u8]) -> Option<String> {
    if let Some(dir) = file_for(anilist_id).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if is_jxl(bytes) {
        let file = file_for(anilist_id);
        if write_atomic(&file, bytes) {
            let _ = std::fs::remove_file(legacy_file_for(anilist_id));
            let path = file.to_string_lossy().to_string();
            db.media_set_cover_file(anilist_id, &path);
            return Some(path);
        }
        return None;
    }
    if store_jpeg_as_jxl(db, anilist_id, bytes).is_some() {
        return Some(file_for(anilist_id).to_string_lossy().to_string());
    }
    // fallback: keep the original bytes renderable (decoded as-is by the webview)
    let file = legacy_file_for(anilist_id);
    if write_atomic(&file, bytes) {
        let path = file.to_string_lossy().to_string();
        db.media_set_cover_file(anilist_id, &path);
        return Some(path);
    }
    None
}

// Decodes a .jxl cover into raw RGB pixels.
fn jxl_to_rgb(jxl: &[u8]) -> Option<(usize, usize, Vec<u8>)> {
    let image = jxl_oxide::JxlImage::builder()
        .read(Cursor::new(jxl))
        .ok()?;
    let render = image.render_frame(0).ok()?;
    let fb = render.image_all_channels();
    let (w, h, ch) = (fb.width(), fb.height(), fb.channels());
    if w == 0 || h == 0 || w > 65535 || h > 65535 {
        return None;
    }
    let mut rgb = Vec::with_capacity(w * h * 3);
    for px in fb.buf().chunks_exact(ch) {
        let pick = |i: usize| -> u8 {
            let v = px.get(i).copied().unwrap_or(0.0);
            (v.clamp(0.0, 1.0) * 255.0).round() as u8
        };
        if ch <= 2 {
            // ch==1: grayscale, ch==2: grayscale + alpha (ignore alpha)
            let g = pick(0);
            rgb.extend_from_slice(&[g, g, g]);
        } else {
            rgb.push(pick(0));
            rgb.push(pick(1));
            rgb.push(pick(2));
        }
    }
    Some((w, h, rgb))
}

// Decodes a .jxl cover back into JPEG bytes for the webview, which has no
// native JPEG XL support. Small images, so this is a few milliseconds.
fn jxl_to_jpeg(jxl: &[u8]) -> Option<Vec<u8>> {
    let (w, h, rgb) = jxl_to_rgb(jxl)?;
    let mut out = Vec::new();
    let enc = jpeg_encoder::Encoder::new(&mut out, JPEG_REENCODE_QUALITY);
    enc.encode(&rgb, w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
        .ok()?;
    Some(out)
}

/// Sniffs the format of pre-JXL cover files, which may have been stored as
/// whatever the CDN returned (JPEG, PNG, WebP or GIF) despite the .jpg name.
fn image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

pub fn image_data(anilist_id: i64) -> Option<String> {
    let jxl_path = file_for(anilist_id);
    if jxl_path.exists() {
        let bytes = std::fs::read(&jxl_path).ok()?;
        let jpeg = jxl_to_jpeg(&bytes)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(jpeg);
        return Some(format!("data:image/jpeg;base64,{b64}"));
    }
    // legacy .jpg fallback (covers downloaded before JPEG XL adoption)
    let path = legacy_file_for(anilist_id);
    if !path.exists() {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let mime = image_mime(&bytes);
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jpeg_to_jxl_roundtrip() {
        // synthetic 64x64 gradient -> JPEG -> JXL -> serveable JPEG
        let (w, h) = (64usize, 64usize);
        let mut rgb = Vec::with_capacity(w * h * 3);
        for y in 0..h {
            for x in 0..w {
                rgb.push((x * 4) as u8);
                rgb.push((y * 4) as u8);
                rgb.push(((x + y) * 2) as u8);
            }
        }
        let mut jpg = Vec::new();
        let enc = jpeg_encoder::Encoder::new(&mut jpg, 85);
        enc.encode(&rgb, w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
            .unwrap();
        assert!(!is_jxl(&jpg));

        let (w2, h2, px) = jpeg_to_rgb(&jpg).expect("jpeg decode");
        assert_eq!((w2, h2), (w, h));

        let jxl = encode_jxl(w2, h2, &px).expect("jxl encode");
        assert!(is_jxl(&jxl));

        let served = jxl_to_jpeg(&jxl).expect("jxl decode + jpeg re-encode");
        assert!(!served.is_empty());
        // SOI marker -> structurally valid JPEG stream; exact pixels are not
        // expected to match bit-for-bit across two lossy generations.
        assert_eq!(served[2], 0xFF);
    }




}
