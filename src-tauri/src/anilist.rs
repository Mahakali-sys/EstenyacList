use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const API_URL: &str = "https://graphql.anilist.co";
// AniList sustained limit is 30 req/min; burst 90. 2.3s per request keeps us safely under.
const MIN_GAP_MS: u64 = 2300;

pub struct AniList {
    client: reqwest::Client,
    last: Arc<Mutex<Instant>>,
    paused: AtomicBool,
}

impl AniList {
    pub fn new() -> AniList {
        AniList {
            client: reqwest::Client::builder()
                .user_agent("EstenyacList/0.1 (personal anime list manager)")
                .timeout(Duration::from_secs(30))
                .build()
                .expect("failed to build http client"),
            last: Arc::new(Mutex::new(Instant::now() - Duration::from_millis(10000))),
            paused: AtomicBool::new(false),
        }
    }

    async fn wait_turn(&self) {
        loop {
            if self.paused.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
            let mut last = self.last.lock().await;
            let el = last.elapsed().as_millis() as u64;
            if el >= MIN_GAP_MS {
                *last = Instant::now();
                return;
            }
            drop(last);
            tokio::time::sleep(Duration::from_millis(MIN_GAP_MS - el + 50)).await;
        }
    }

    pub async fn graphql(&self, query: &str, variables: Value) -> Result<Value, String> {
        self.request(query, variables, None).await
    }

    pub async fn exchange_code(
        &self,
        client_id: &str,
        client_secret: &str,
        code: &str,
    ) -> Result<String, String> {
        let body = json!({
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": "https://anilist.co/api/v2/oauth/pin",
            "code": code,
        });
        let resp = self
            .client
            .post("https://anilist.co/api/v2/oauth/token")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("AniList token exchange failed: {e}"))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !status.is_success() {
            let err = v.get("error").and_then(|x| x.as_str()).unwrap_or("");
            let msg = v.get("message").and_then(|x| x.as_str()).unwrap_or("");
            let hint = v.get("hint").and_then(|x| x.as_str()).unwrap_or("");
            if !err.is_empty() || !msg.is_empty() {
                let mut parts = Vec::new();
                if !err.is_empty() {
                    parts.push(err.to_string());
                }
                if !msg.is_empty() {
                    parts.push(msg.to_string());
                }
                if !hint.is_empty() {
                    parts.push(hint.to_string());
                }
                return Err(format!("AniList token exchange failed: {}", parts.join(" · ")));
            }
            return Err(format!(
                "AniList token exchange failed ({status}): {}",
                text.chars().take(300).collect::<String>()
            ));
        }
        v.get("access_token")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| "AniList did not return an access token".to_string())
    }

    pub async fn graphql_auth(
        &self,
        token: &str,
        query: &str,
        variables: Value,
    ) -> Result<Value, String> {
        self.request(query, variables, Some(token)).await
    }

    async fn request(
        &self,
        query: &str,
        variables: Value,
        token: Option<&str>,
    ) -> Result<Value, String> {
        let mut attempt = 0;
        loop {
            self.wait_turn().await;
            let body = json!({ "query": query, "variables": variables });
            let mut req = self.client.post(API_URL).json(&body);
            if let Some(t) = token {
                req = req.bearer_auth(t);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("AniList request failed: {e}"))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status == 429 {
                attempt += 1;
                if attempt >= 4 {
                    return Err("AniList rate limit hit repeatedly, giving up".into());
                }
                let wait = 8u64 * attempt as u64;
                log::warn!("AniList 429, waiting {}s", wait);
                tokio::time::sleep(Duration::from_secs(wait)).await;
                continue;
            }
            if status == 503 || status == 502 {
                attempt += 1;
                if attempt >= 3 {
                    return Err("AniList service unavailable".into());
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
            if status == 404 {
                return Err("Not found on AniList".into());
            }
            if !status.is_success() {
                return Err(format!("AniList error {status}: {}", text.chars().take(300).collect::<String>()));
            }
            let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad json: {e}"))?;
            if let Some(errs) = v.get("errors").and_then(|e| e.as_array()) {
                let msg = errs
                    .first()
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown error");
                return Err(format!("AniList: {msg}"));
            }
            return Ok(v.get("data").cloned().unwrap_or(Value::Null));
        }
    }

    pub async fn search(&self, query: &str, media_type: &str) -> Result<Vec<MediaSummary>, String> {
        let q = MEDIA_FIELDS;
        let vars = json!({
            "q": query,
            "type": media_type,
            "page": 1,
            "perPage": 50
        });
        let data = self
            .graphql(
                &format!(
                    "query ($q: String, $type: MediaType, $page: Int, $perPage: Int) {{
                        Page(page: $page, perPage: $perPage) {{ media(search: $q, type: $type, sort: SEARCH_MATCH) {{ {q} }} }}
                    }}"
                ),
                vars,
            )
            .await?;
        let list = data
            .get("Page")
            .and_then(|p| p.get("media"))
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.into_iter().filter_map(|m| MediaSummary::parse(&m)).collect())
    }

    pub async fn media_by_id(&self, id: i64) -> Result<Value, String> {
        let q = MEDIA_FIELDS;
        let data = self
            .graphql(
                &format!(
                    "query ($id: Int) {{ Media(id: $id) {{ {q} }} }}"
                ),
                json!({ "id": id }),
            )
            .await?;
        Ok(data.get("Media").cloned().unwrap_or(Value::Null))
    }

    pub async fn media_by_idmal(&self, mal_id: i64, media_type: &str) -> Result<Value, String> {
        let q = MEDIA_FIELDS;
        let data = self
            .graphql(
                &format!(
                    "query ($id: Int, $type: MediaType) {{ Media(idMal: $id, type: $type) {{ {q} }} }}"
                ),
                json!({ "id": mal_id, "type": media_type }),
            )
            .await?;
        Ok(data.get("Media").cloned().unwrap_or(Value::Null))
    }

    pub async fn viewer_id(&self, token: &str) -> Result<i64, String> {
        let data = self
            .graphql_auth(token, "query { Viewer { id } }", json!({}))
            .await?;
        data.pointer("/Viewer/id")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| "AniList did not return a user id".to_string())
    }

    /// The user's whole list for one media type, grouped by list name. The
    /// same entry can appear in several groups (status list + custom lists),
    /// so callers must dedupe by media id.
    pub async fn media_list_collection(
        &self,
        token: &str,
        user_id: i64,
        media_type: &str,
    ) -> Result<Value, String> {
        let media_fields = LIST_MEDIA_FIELDS;
        let query = format!(
            r#"query ($userId: Int, $type: MediaType) {{
                MediaListCollection(userId: $userId, type: $type) {{
                    lists {{ entries {{
                        status
                        score(format: POINT_100)
                        progress
                        repeat
                        notes
                        startedAt {{ year month day }}
                        completedAt {{ year month day }}
                        customLists {{ name enabled }}
                        media {{ {media_fields} }}
                    }} }}
                }}
            }}"#
        );
        self.graphql_auth(
            token,
            &query,
            json!({ "userId": user_id, "type": media_type }),
        )
        .await
    }

    pub async fn schedule(&self, from: i64, to: i64) -> Result<Vec<ScheduleMedia>, String> {
        let mut out = Vec::new();
        for page in 1..=14 {
            let q = SCHEDULE_FIELDS;
            let vars = json!({
                "from": from, "to": to, "page": page, "perPage": 50
            });
            let data = self
                .graphql(
                    &format!(
                        "query ($from: Int, $to: Int, $page: Int, $perPage: Int) {{
                            Page(page: $page, perPage: $perPage) {{
                                pageInfo {{ hasNextPage }}
                                airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {{
                                    airingAt
                                    episode
                                    media {{ {q} }}
                                }}
                            }}
                        }}"
                    ),
                    vars,
                )
                .await?;
            let page_data = data.get("Page").cloned().unwrap_or(Value::Null);
            let items = page_data
                .get("airingSchedules")
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            for item in &items {
                if let (Some(at), Some(ep), Some(media)) = (
                    item.get("airingAt").and_then(|x| x.as_i64()),
                    item.get("episode").and_then(|x| x.as_i64()),
                    item.get("media"),
                ) {
                    if let Some(sm) = ScheduleMedia::parse(media, at, ep) {
                        out.push(sm);
                    }
                }
            }
            let has_next = page_data
                .get("pageInfo")
                .and_then(|p| p.get("hasNextPage"))
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            if !has_next || items.is_empty() {
                break;
            }
        }
        Ok(out)
    }
}

pub const MEDIA_FIELDS: &str = r#"
  id
  idMal
  type
  format
  status
  episodes
  chapters
  volumes
  duration
  averageScore
  season
  seasonYear
  isAdult
  description(asHtml: false)
  genres
  title { romaji english native }
  coverImage { large }
  studios(isMain: true) { nodes { name } }
"#;

pub const SCHEDULE_FIELDS: &str = r#"
  id
  type
  format
  status
  episodes
  chapters
  volumes
  averageScore
  season
  seasonYear
  isAdult
  genres
  title { romaji english native }
  coverImage { large }
"#;

// list-entry media payload: everything the pull merge needs, minus the heavy
// description/studios fields (media_upsert COALESCEs, so existing rows keep them)
pub const LIST_MEDIA_FIELDS: &str = r#"
  id
  idMal
  type
  format
  status
  episodes
  chapters
  volumes
  duration
  averageScore
  season
  seasonYear
  genres
  title { romaji english native }
  coverImage { large }
"#;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaSummary {
    pub id: i64,
    pub id_mal: Option<i64>,
    pub media_type: String,
    pub format: Option<String>,
    pub status: Option<String>,
    pub episodes: Option<i64>,
    pub chapters: Option<i64>,
    pub volumes: Option<i64>,
    pub title_romaji: Option<String>,
    pub title_english: Option<String>,
    pub title_native: Option<String>,
    pub cover_url: Option<String>,
    pub description: Option<String>,
    pub average_score: Option<i64>,
    pub genres: Option<Vec<String>>,
    pub season: Option<String>,
    pub season_year: Option<i64>,
    pub in_list: Option<String>,
}

impl MediaSummary {
    pub fn parse(v: &Value) -> Option<MediaSummary> {
        let id = v.get("id").and_then(|x| x.as_i64())?;
        let title = v.get("title").cloned().unwrap_or(Value::Null);
        let g = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string());
        let t = |k: &str| {
            title
                .get(k)
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        };
        let cover: Option<String> = v
            .get("coverImage")
            .and_then(|c| c.get("large"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        Some(MediaSummary {
            id,
            id_mal: v.get("idMal").and_then(|x| x.as_i64()),
            media_type: g("type").unwrap_or_default(),
            format: g("format"),
            status: g("status"),
            episodes: v.get("episodes").and_then(|x| x.as_i64()),
            chapters: v.get("chapters").and_then(|x| x.as_i64()),
            volumes: v.get("volumes").and_then(|x| x.as_i64()),
            title_romaji: t("romaji"),
            title_english: t("english"),
            title_native: t("native"),
            cover_url: cover,
            description: g("description"),
            average_score: v.get("averageScore").and_then(|x| x.as_i64()),
            genres: v
                .get("genres")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()),
            season: g("season"),
            season_year: v.get("seasonYear").and_then(|x| x.as_i64()),
            // AniList has no list-status field on Media; the command layer
            // fills this in from the local database for searches.
            in_list: None,
        })
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleMedia {
    pub media: MediaSummary,
    pub airing_at: i64,
    pub episode: i64,
}

impl ScheduleMedia {
    pub fn parse(v: &Value, airing_at: i64, episode: i64) -> Option<ScheduleMedia> {
        let media = MediaSummary::parse(v)?;
        Some(ScheduleMedia { media, airing_at, episode })
    }
}