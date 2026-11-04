use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;

/// nyaa.si itself, queried through its native RSS endpoint. The old proxy
/// (nyaaapi.onrender.com) is gone — see parse_rss below.
const NYAA_BASE: &str = "https://nyaa.si";

#[derive(Serialize, Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NyaaFilters {
    pub enabled: bool,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
}

impl NyaaFilters {
    pub fn default_filters() -> NyaaFilters {
        NyaaFilters {
            enabled: true,
            include: vec!["1080".into()],
            exclude: vec!["720".into(), "480".into(), "360".into(), "multi-sub".into(), "spanish".into(), "eng dub".into()],
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NyaaResult {
    pub id: String,
    pub title: String,
    pub size: Option<String>,
    pub date: Option<String>,
    pub seeders: i64,
    pub leechers: i64,
    pub downloads: i64,
    pub url: Option<String>,
    pub magnet: Option<String>,
    pub torrent: Option<String>,
}

pub struct Nyaa {
    client: reqwest::Client,
    lock: Arc<AsyncMutex<Instant>>,
}

impl Nyaa {
    pub fn new() -> Nyaa {
        Nyaa {
            client: reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) EstenyacList")
                .timeout(Duration::from_secs(15))
                .build()
                .expect("failed to build http client"),
            lock: Arc::new(AsyncMutex::new(Instant::now() - Duration::from_secs(30))),
        }
    }

    async fn wait_turn(&self) {
        // at most ~10 requests per minute — be nice to the public site.
        // loops so concurrent callers stay spaced instead of bursting together
        loop {
            let mut last = self.lock.lock().await;
            let el = last.elapsed().as_millis() as u64;
            if el >= 6500 {
                *last = Instant::now();
                return;
            }
            let wait = 6500 - el;
            drop(last);
            tokio::time::sleep(Duration::from_millis(wait)).await;
        }
    }

    pub async fn search(&self, query: &str) -> Result<Vec<NyaaResult>, String> {
        self.wait_turn().await;
        // anime categories only: 1_2 english-translated (fansubs + batches),
        // 1_3 non-english-translated (pt-br and other regional fansubs)
        let url = format!(
            "{NYAA_BASE}/?page=rss&q={}&f=0&c=1_2&c=1_3&s=seeders&o=desc",
            urlencoding_encode(query)
        );
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Nyaa request failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("Nyaa RSS error {}", resp.status()));
        }
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Nyaa rss read failed: {e}"))?;
        Ok(parse_rss(&text))
    }

    pub fn apply_filters(&self, results: Vec<NyaaResult>, filters: &NyaaFilters) -> Vec<NyaaResult> {
        if !filters.enabled || (filters.include.is_empty() && filters.exclude.is_empty()) {
            return results;
        }
        results
            .into_iter()
            .filter(|r| {
                let t = r.title.to_lowercase();
                let mut inc = filters.include.is_empty();
                for pat in &filters.include {
                    if pat.is_empty() {
                        continue;
                    }
                    if t.contains(&pat.to_lowercase()) {
                        inc = true;
                    } else {
                        inc = false;
                        break;
                    }
                }
                let mut exc = false;
                for pat in &filters.exclude {
                    if !pat.is_empty() && t.contains(&pat.to_lowercase()) {
                        exc = true;
                        break;
                    }
                }
                inc && !exc
            })
            .collect()
    }
}

// ---------- RSS parsing ----------

#[derive(Default)]
struct RssItem {
    title: String,
    guid: String,
    link: String,
    pub_date: String,
    info_hash: String,
    size: String,
    seeders: i64,
    leechers: i64,
    downloads: i64,
}

impl RssItem {
    fn set(&mut self, tag: &str, text: &str) {
        match tag {
            "title" => self.title = text.trim().to_string(),
            "guid" => self.guid = text.trim().to_string(),
            "link" => self.link = text.trim().to_string(),
            "pubDate" => self.pub_date = text.trim().to_string(),
            "nyaa:infoHash" => self.info_hash = text.trim().to_string(),
            "nyaa:size" => self.size = text.trim().to_string(),
            "nyaa:seeders" => self.seeders = text.trim().parse().unwrap_or(0),
            "nyaa:leechers" => self.leechers = text.trim().parse().unwrap_or(0),
            "nyaa:downloads" => self.downloads = text.trim().parse().unwrap_or(0),
            _ => {}
        }
    }

    fn into_result(self) -> Option<NyaaResult> {
        if self.title.is_empty() {
            return None;
        }
        // in nyaa's RSS feed <link> is the .torrent download URL and <guid>
        // is the view page — the opposite of what most feeds do
        let view_url = if self.guid.is_empty() {
            self.link.clone()
        } else {
            self.guid
        };
        let mut id = view_url
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if let Some(stripped) = id.strip_suffix(".torrent") {
            id = stripped.to_string();
        }
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let torrent = if self.link.ends_with(".torrent") {
            Some(self.link)
        } else {
            Some(format!("{NYAA_BASE}/download/{id}.torrent"))
        };
        let url = Some(if view_url.starts_with("http") {
            view_url
        } else {
            format!("{NYAA_BASE}/view/{id}")
        });
        // RSS carries no magnet link, but the v1 info hash lets us build one;
        // v2-only releases (hash != 40 hex chars) keep magnet empty
        let magnet = if self.info_hash.len() == 40
            && self.info_hash.chars().all(|c| c.is_ascii_hexdigit())
        {
            Some(format!(
                "magnet:?xt=urn:btih:{}&dn={}",
                self.info_hash,
                percent_encode_dn(&self.title)
            ))
        } else {
            None
        };
        Some(NyaaResult {
            id,
            title: self.title,
            size: if self.size.is_empty() { None } else { Some(self.size) },
            date: format_pub_date(&self.pub_date),
            seeders: self.seeders,
            leechers: self.leechers,
            downloads: self.downloads,
            url,
            magnet,
            torrent,
        })
    }
}

/// Parses a nyaa.si RSS response (`?page=rss`) into results.
pub fn parse_rss(xml: &str) -> Vec<NyaaResult> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut out = Vec::new();
    let mut buf = Vec::new();
    let mut in_item = false;
    let mut current_tag: Option<String> = None;
    let mut item = RssItem::default();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "item" {
                    in_item = true;
                    item = RssItem::default();
                    current_tag = None;
                } else if in_item {
                    current_tag = Some(name);
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(tag) = &current_tag {
                    if let Ok(text) = t.unescape() {
                        item.set(tag, &text);
                    }
                }
            }
            Ok(Event::CData(t)) => {
                if let Some(tag) = &current_tag {
                    let text = String::from_utf8_lossy(&t).to_string();
                    item.set(tag, &text);
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if name == "item" {
                    in_item = false;
                    let done = std::mem::take(&mut item);
                    if let Some(r) = done.into_result() {
                        out.push(r);
                    }
                }
                current_tag = None;
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                crate::db::append_log(&format!("nyaa rss parse error: {e}"));
                break;
            }
            _ => {}
        }
        buf.clear();
    }
    out
}

fn format_pub_date(raw: &str) -> Option<String> {
    let dt = chrono::DateTime::parse_from_rfc2822(raw).ok()?;
    Some(dt.format("%Y-%m-%d %H:%M").to_string())
}

/// Magnet display names use %20 for spaces (the `+` convention is query-string
/// specific) and percent-encode everything outside the unreserved set.
pub(crate) fn percent_encode_dn(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

pub(crate) fn urlencoding_encode(s: &str) -> String {
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

pub fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Checks whether a Nyaa release title plausibly corresponds to (series, episode).
pub fn matches_episode(title: &str, series_tokens: &[String], episode: i64) -> bool {
    let t = normalize(title);
    let present = series_tokens.iter().filter(|tok| t.contains(tok.as_str())).count();
    if present == 0 {
        return false;
    }
    let need = if series_tokens.len() <= 2 { 1 } else { 2 };
    if present < need {
        return false;
    }
    let ep = episode.to_string();
    let ep2 = format!("{episode:02}");
    // all punctuation is stripped by normalize(), so match bare episode tokens:
    // "solo leveling 01 1080p" (from "- 01", "[01]", "(01)"), "ep 01", "ep01", "E01"
    let t = format!(" {t} ");
    let pats = [
        format!(" {ep} "),
        format!(" {ep2} "),
        format!("ep {ep} "),
        format!("ep {ep2} "),
        format!("episode {ep} "),
        format!("episode {ep2} "),
        format!("ep{ep} "),
        format!("ep{ep2} "),
        format!("e{ep} "),
        format!("e{ep2} "),
    ];
    pats.iter().any(|p| t.contains(p.as_str()))
}

/// Builds candidate Nyaa search queries for a series, from most to least specific.
/// Groups often release under shortened names, so beyond the full titles we also
/// try distinctive fragments: longest words, token pairs, and the native title.
pub fn search_queries(
    romaji: &str,
    english: Option<&str>,
    native: Option<&str>,
    episode: i64,
) -> Vec<String> {
    let mut qs: Vec<String> = Vec::new();
    let mut push = |q: String| {
        let q = q.trim().to_string();
        if !q.is_empty() && !qs.contains(&q) {
            qs.push(q);
        }
    };

    let rom = romaji.trim();
    if rom.is_empty() {
        return qs;
    }

    // 1. full romaji title, with and without the episode number
    push(format!("{rom} {episode}"));
    push(rom.to_string());

    // 2. full english title (different from romaji), with and without episode
    if let Some(en) = english {
        let en = en.trim();
        if !en.is_empty() && en.to_lowercase() != rom.to_lowercase() {
            push(format!("{en} {episode}"));
            push(en.to_string());
        }
    }

    // 3. full native title (many groups post with the Japanese title)
    if let Some(nat) = native {
        let nat = nat.trim();
        if !nat.is_empty() {
            push(format!("{nat} {episode}"));
            push(nat.to_string());
        }
    }

    // 4. most distinctive single words (longest first)
    let mut toks = series_tokens(romaji, english, native);
    toks.sort_by_key(|w| std::cmp::Reverse(w.len()));
    for w in toks.iter().take(2) {
        if w.len() >= 5 {
            push(format!("{w} {episode}"));
            push(w.clone());
        }
    }

    // 5. adjacent token pairs ("madoka magica", "tensei slime" ...)
    for pair in toks.windows(2) {
        let p = format!("{} {}", pair[0], pair[1]);
        push(format!("{p} {episode}"));
        push(p);
    }

    qs
}

/// Builds a series token list from titles (first few significant romaji/english words).
pub fn series_tokens(romaji: &str, english: Option<&str>, native: Option<&str>) -> Vec<String> {
    let mut toks = Vec::new();
    for src in [romaji, english.unwrap_or(""), native.unwrap_or("")]
        .iter()
        .filter(|s| !s.is_empty())
    {
        let n = normalize(src);
        for w in n.split_whitespace() {
            if toks.len() >= 4 {
                break;
            }
            if w.chars().all(|c| c.is_numeric()) && w.len() <= 3 {
                continue; // skip season numbers like "2" in "Fate 2"
            }
            // release titles use latin script; kana/native words never appear there
            if !w.chars().all(|c| c.is_ascii_alphabetic()) {
                continue;
            }
            if w.len() >= 3 && !toks.contains(&w.to_string()) {
                toks.push(w.to_string());
            }
        }
    }
    toks
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nyaa_rss_sample() {
        let xml = include_str!("testdata/nyaa_sample.xml");
        let results = parse_rss(xml);
        assert!(results.len() >= 2, "expected at least 2 items, got {}", results.len());
        let first = &results[0];
        assert!(first.title.contains("Solo Leveling"));
        assert_eq!(first.id, "2156068");
        assert_eq!(first.url.as_deref(), Some("https://nyaa.si/view/2156068"));
        assert_eq!(
            first.torrent.as_deref(),
            Some("https://nyaa.si/download/2156068.torrent")
        );
        assert!(first.magnet.as_deref().unwrap_or("").starts_with(
            "magnet:?xt=urn:btih:856a43e6c231e6e2fe89b04936c45d71fb6b9024&dn="
        ));
        assert_eq!(first.seeders, 22);
        assert_eq!(first.leechers, 0);
        assert_eq!(first.downloads, 368);
        assert_eq!(first.size.as_deref(), Some("51.9 GiB"));
        assert_eq!(first.date.as_deref(), Some("2026-09-04 03:15"));
    }

    #[test]
    fn percent_encodes_magnet_dn() {
        assert_eq!(
            percent_encode_dn("[Subs] Show - 01 [1080p]"),
            "%5BSubs%5D%20Show%20-%2001%20%5B1080p%5D"
        );
    }
}
