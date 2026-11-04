use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Serialize, Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NekoFilters {
    pub enabled: bool,
    pub levels: Vec<i64>,
    pub audio_lang: Vec<String>,
    pub fsub_lang: Vec<String>,
    pub sub_lang: Vec<String>,
    pub hardsub: Option<bool>,
    pub batch: Option<bool>,
    pub otl: Option<bool>,
    pub mtl: Option<bool>,
    pub include_groups: Vec<String>,
    pub exclude_groups: Vec<String>,
}

impl NekoFilters {
    pub fn default_filters() -> NekoFilters {
        NekoFilters {
            enabled: true,
            levels: Vec::new(),
            audio_lang: Vec::new(),
            fsub_lang: Vec::new(),
            sub_lang: Vec::new(),
            hardsub: None,
            batch: None,
            otl: None,
            mtl: None,
            include_groups: Vec::new(),
            exclude_groups: Vec::new(),
        }
    }
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NekoGroup {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub tag: String,
    pub display_tag: String,
    pub tagline: Option<String>,
    pub pfp_hash: Option<String>,
    pub torrent_count: Option<String>,
    pub download_count: Option<String>,
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NekoMediaResult {
    pub id: String,
    pub title: String,
    pub year: Option<i64>,
    pub status: Option<String>,
    pub alternate_titles: Option<Vec<String>>,
    pub similarity: Option<f64>,
    pub genres: Option<Vec<String>>,
    pub overview: Option<String>,
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NekoTorrent {
    pub id: String,
    pub title: String,
    pub magnet: Option<String>,
    pub private_magnet: Option<String>,
    pub filesize: Option<String>,
    pub seeders: Option<String>,
    pub leechers: Option<String>,
    pub completed: Option<String>,
    pub media_id: Option<String>,
    pub media_episode_ids: Option<Vec<String>>,
    pub video_type: Option<i64>,
    pub video_codec: Option<i64>,
    pub level: Option<i64>,
    pub audio_lang: Option<String>,
    pub sub_lang: Option<String>,
    pub fsub_lang: Option<String>,
    pub hardsub: Option<bool>,
    pub batch: Option<bool>,
    pub otl: Option<bool>,
    pub mtl: Option<bool>,
    #[serde(default, deserialize_with = "de_str_or_int")]
    pub uploaded_at: Option<String>,
    pub groups: Option<Vec<NekoTorrentGroup>>,
    pub imported: Option<i64>,
}

/// the API sends uploaded_at as epoch-ms integer on some responses and as a
/// string on others; accept both so a single torrent never breaks parsing.
fn de_str_or_int<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|x| match x {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }))
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NekoTorrentGroup {
    pub id: String,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub uploading_group: Option<bool>,
}

pub struct Neko {
    client: reqwest::Client,
    lock: Arc<AsyncMutex<Instant>>,
    pub base: Mutex<String>,
    pub key: Mutex<String>,
}

impl Neko {
    pub fn new(base: String, key: String) -> Neko {
        Neko {
            client: reqwest::Client::builder()
                .user_agent("EstenyacList/0.1 (personal anime list manager)")
                .timeout(Duration::from_secs(6))
                .build()
                .expect("failed to build http client"),
            lock: Arc::new(AsyncMutex::new(Instant::now() - Duration::from_secs(30))),
            base: Mutex::new(base),
            key: Mutex::new(key),
        }
    }

    pub fn set_base(&self, base: String) {
        if let Ok(mut b) = self.base.lock() {
            *b = base;
        }
    }

    pub fn set_key(&self, key: String) {
        if let Ok(mut k) = self.key.lock() {
            *k = key;
        }
    }

    pub fn base_url(&self) -> String {
        self.base.lock().map(|b| b.clone()).unwrap_or_default()
    }

    pub fn has_key(&self) -> bool {
        self.key.lock().map(|k| !k.is_empty()).unwrap_or(false)
    }

    fn key_value(&self) -> String {
        self.key.lock().map(|k| k.clone()).unwrap_or_default()
    }

    async fn wait_turn(&self) {
        let mut last = self.lock.lock().await;
        let el = last.elapsed().as_millis() as u64;
        if el < 2000 {
            drop(last);
            tokio::time::sleep(Duration::from_millis(2000 - el)).await;
            let mut last = self.lock.lock().await;
            *last = Instant::now();
        } else {
            *last = Instant::now();
        }
    }

    async fn get(&self, path: &str, params: &[(String, String)]) -> Result<Value, String> {
        let base = self.base_url().trim_end_matches('/').to_string();
        let mut url = format!("{base}/api/v1{path}");
        if !params.is_empty() {
            let qs: Vec<String> = params
                .iter()
                .map(|(k, v)| format!("{}={}", urlencoding_encode(k), urlencoding_encode(v)))
                .collect();
            url.push('?');
            url.push_str(&qs.join("&"));
        }
        let key = self.key_value();
        let mut attempt = 0;
        loop {
            attempt += 1;
            self.wait_turn().await;
            let mut req = self.client.get(&url);
            if !key.is_empty() {
                req = req.header(reqwest::header::COOKIE, format!("ssid={key}"));
            }
            let resp = req.send().await.map_err(|e| format!("nekoBT request failed: {e}"))?;
            let status = resp.status();
            if status == 429 {
                // API rate limit: JSON with retry_after, or Cloudflare HTML with Retry-After header
                let retry = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|s| s.parse::<f64>().ok());
                let retry = if retry.is_some() {
                    retry
                } else {
                    resp.json::<Value>()
                        .await
                        .ok()
                        .and_then(|v| v.get("retry_after").and_then(|r| r.as_f64()))
                };
                let wait = retry.unwrap_or(5.0).min(30.0);
                if attempt < 4 {
                    tokio::time::sleep(Duration::from_secs_f64(wait)).await;
                    continue;
                }
                return Err(format!("nekoBT rate limited (retry after {wait:.0}s)"));
            }
            if status == 401 {
                return Err("nekoBT: invalid API key (401 Unauthorized)".into());
            }
            if !status.is_success() {
                let msg = resp
                    .json::<Value>()
                    .await
                    .ok()
                    .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
                    .unwrap_or_else(|| format!("HTTP {status}"));
                return Err(format!("nekoBT error: {msg}"));
            }
            return resp.json::<Value>().await.map_err(|e| format!("bad json from nekoBT: {e}"));
        }
    }

    pub async fn search_media(&self, query: &str) -> Result<Vec<NekoMediaResult>, String> {
        let v = self
            .get(
                "/media/search",
                &[
                    ("query".into(), query.to_string()),
                    ("limit".into(), "20".into()),
                ],
            )
            .await?;
        Ok(v.get("data")
            .and_then(|d| d.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| serde_json::from_value(m).ok())
            .collect())
    }

    pub async fn search_groups(&self, query: &str, limit: i64) -> Result<Vec<NekoGroup>, String> {
        let v = self
            .get(
                "/groups/search",
                &[
                    ("query".into(), query.to_string()),
                    ("limit".into(), limit.to_string()),
                ],
            )
            .await?;
        Ok(v.get("data")
            .and_then(|d| d.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| serde_json::from_value(m).ok())
            .collect())
    }

    pub async fn search_torrents(&self, params: &[(String, String)]) -> Result<Vec<NekoTorrent>, String> {
        let v = self.get("/torrents/search", params).await?;
        let raw: Vec<Value> = v
            .get("data")
            .and_then(|d| d.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        let mut results = Vec::new();
        let mut parse_errors: Vec<String> = Vec::new();
        if let Some(first) = raw.first() {
            if let Some(obj) = first.as_object() {
                crate::db::append_log(&format!(
                    "  neko: raw torrent[0] keys={:?}",
                    obj.keys().cloned().collect::<Vec<_>>()
                ));
            }
        }
        for m in raw {
            match serde_json::from_value::<NekoTorrent>(m) {
                Ok(t) => results.push(t),
                Err(e) => parse_errors.push(e.to_string()),
            }
        }
        if results.is_empty() {
            if let Some(e) = v.get("error") {
                crate::db::append_log(&format!("  neko: api envelope error={e}"));
            }
            if !parse_errors.is_empty() {
                crate::db::append_log(&format!(
                    "  neko: {} raw torrents, ALL FAILED TO PARSE: {}",
                    parse_errors.len(),
                    parse_errors.first().map(|s| s.as_str()).unwrap_or("")
                ));
            } else {
                crate::db::append_log(&format!(
                    "  neko: api returned 0 raw torrents; data keys={:?}",
                    v.get("data")
                        .and_then(|d| d.as_object())
                        .map(|o| o.keys().cloned().collect::<Vec<_>>())
                ));
            }
        }
        Ok(results)
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

