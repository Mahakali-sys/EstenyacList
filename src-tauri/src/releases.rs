use crate::db::{Db, ReleaseRow, ScheduleRow};
use crate::neko::{self, Neko, NekoFilters, NekoTorrent};
use crate::nyaa::{self, Nyaa, NyaaFilters};
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// A healthy tracker API answers in well under a second or two; anything past
// this is effectively down for interactive search (per-request, in the clients).
const SMART_BUDGET_SECS: u64 = 15;
// Pinned modes are deliberate choices — allow slow-but-alive servers, but
// still cap so a search can never hang forever.
const PINNED_BUDGET_SECS: u64 = 60;

// Bounds the whole (multi-call) search of one tracker.
async fn budgeted<F, T>(secs: u64, fut: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    match tokio::time::timeout(Duration::from_secs(secs), fut).await {
        Ok(r) => r,
        Err(_) => Err(format!("timed out after {secs}s")),
    }
}

pub async fn search_for_schedule_item(
    app: &AppHandle,
    db: &Db,
    nyaa: &Nyaa,
    neko: &Neko,
    item: &ScheduleRow,
    nyaa_filters: &NyaaFilters,
    neko_filters: &NekoFilters,
    tracker: &str,
    auto: bool,
) -> Result<usize, String> {
    let romaji = item.title_romaji.clone().unwrap_or_default();
    if romaji.is_empty() {
        db.schedule_mark_searched(item.anilist_id, item.episode);
        return Ok(0);
    }

    let include_groups = {
        let (media_include, _) = db.media_groups_get(item.anilist_id);
        if media_include.is_empty() {
            neko_filters.include_groups.clone()
        } else {
            media_include
        }
    };

    crate::db::append_log(&format!(
        "== search anime {} ep {} | mode={tracker} neko_key={}",
        item.anilist_id,
        item.episode,
        neko.has_key()
    ));

    // pinned: nekoBT only
    if tracker == "neko" {
        if !neko.has_key() {
            return Err("nekoBT selected as tracker but no API key is set".into());
        }
        let rows = budgeted(
            PINNED_BUDGET_SECS,
            search_neko(db, neko, item, &romaji, neko_filters, nyaa_filters),
        )
        .await?;
        return insert_results(app, db, item, rows, auto).await;
    }
    // pinned: nyaa only
    if tracker == "nyaa" {
        let rows = budgeted(
            PINNED_BUDGET_SECS,
            search_nyaa(nyaa, db, item, &romaji, nyaa_filters, &include_groups),
        )
        .await?;
        return insert_results(app, db, item, rows, auto).await;
    }

    // smart mode: query both trackers concurrently under a hard budget; if one
    // is unreachable or too slow, use the other; otherwise keep the set whose
    // best release has more seeders (ties go to nyaa — public magnets, no auth
    // needed).
    let try_neko = neko.has_key();
    let (neko_res, nyaa_res) = tokio::join!(
        async {
            if !try_neko {
                return Err("nekoBT key not set".to_string());
            }
            budgeted(
                SMART_BUDGET_SECS,
                search_neko(db, neko, item, &romaji, neko_filters, nyaa_filters),
            )
            .await
        },
        budgeted(
            SMART_BUDGET_SECS,
            search_nyaa(nyaa, db, item, &romaji, nyaa_filters, &include_groups)
        ),
    );
    let mut neko_rows = match neko_res {
        Ok(r) => Some(r),
        Err(e) => {
            crate::db::append_log(&format!("  smart: nekoBT unavailable: {e}"));
            None
        }
    };
    let mut nyaa_rows = match nyaa_res {
        Ok(r) => Some(r),
        Err(e) => {
            crate::db::append_log(&format!("  smart: nyaa unavailable: {e}"));
            None
        }
    };
    let n_best = neko_rows
        .as_ref()
        .and_then(|rows| rows.iter().map(|r| r.seeders).max());
    let m_best = nyaa_rows
        .as_ref()
        .and_then(|rows| rows.iter().map(|r| r.seeders).max());
    crate::db::append_log(&format!(
        "  smart: neko rows={} best={n_best:?} | nyaa rows={} best={m_best:?}",
        neko_rows.as_ref().map(|r| r.len()).unwrap_or(0),
        nyaa_rows.as_ref().map(|r| r.len()).unwrap_or(0),
    ));
    let rows = match (neko_rows.as_ref(), nyaa_rows.as_ref()) {
        (None, None) => {
            return Err("nekoBT and Nyaa are both unreachable".into());
        }
        (Some(_), None) => neko_rows.take().unwrap_or_default(),
        (None, Some(_)) => nyaa_rows.take().unwrap_or_default(),
        (Some(_), Some(_)) => {
            if n_best.unwrap_or(0) > m_best.unwrap_or(0) {
                neko_rows.take().unwrap_or_default()
            } else {
                nyaa_rows.take().unwrap_or_default()
            }
        }
    };
    insert_results(app, db, item, rows, auto).await
}

/// Global Nyaa-style title filters, applied to both trackers: a release is
/// kept only when its title contains ALL include patterns and NONE of the
/// exclude patterns (empty include list keeps everything). Mirror of
/// `nyaa.rs::apply_filters` for ReleaseRow values.
fn passes_title_filters(title: &str, include: &[String], exclude: &[String]) -> bool {
    let t = title.to_lowercase();
    let mut inc = include.is_empty();
    for pat in include {
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
    let exc = exclude
        .iter()
        .any(|p| !p.is_empty() && t.contains(&p.to_lowercase()));
    inc && !exc
}

/// nekoBT: match media by title, then search torrents with full API filters.
/// The global Nyaa title filters (quality patterns etc.) are applied to the
/// results here as well, so they track identically on both trackers.
async fn search_neko(
    db: &Db,
    neko: &Neko,
    item: &ScheduleRow,
    romaji: &str,
    filters: &NekoFilters,
    nyaa_filters: &NyaaFilters,
) -> Result<Vec<ReleaseRow>, String> {
    let (media_include, media_exclude) = db.media_groups_get(item.anilist_id);
    let include_groups: Vec<String> = if media_include.is_empty() {
        filters.include_groups.clone()
    } else {
        media_include
    };
    let mut exclude_groups = filters.exclude_groups.clone();
    for g in media_exclude {
        if !exclude_groups.contains(&g) {
            exclude_groups.push(g);
        }
    }

    // find the nekoBT media id by searching the title variants
    let custom_names = db.search_names_get(item.anilist_id);
    crate::db::append_log(&format!(
        "  neko: custom_names={custom_names:?} include={include_groups:?} exclude={exclude_groups:?}",
    ));
    let mut queries: Vec<String> = custom_names.clone();
    queries.extend(nyaa::search_queries(
        romaji,
        item.title_english.as_deref(),
        item.title_native.as_deref(),
        item.episode,
    ));
    let mut best_media: Option<neko::NekoMediaResult> = None;
    let mut best_score = 0.0f64;
    for q in queries {
        crate::db::append_log(&format!("  neko: media search query={q:?}"));
        match neko.search_media(&q).await {
            Ok(list) => {
                crate::db::append_log(&format!("  neko: media search -> {} results", list.len()));
                for m in list {
                    let score = media_score(&m, romaji, item.title_english.as_deref());
                    if score > best_score {
                        best_score = score;
                        best_media = Some(m);
                    }
                }
                if best_score >= 0.6 {
                    break;
                }
            }
            Err(e) => {
                crate::db::append_log(&format!("  neko: media search error: {e}"));
            }
        }
        if best_score >= 0.6 {
            break;
        }
    }
    crate::db::append_log(&format!(
        "  neko: best_media={:?} score={best_score}",
        best_media.as_ref().map(|m| &m.title)
    ));

    // Query is a hint: with group_id set, the API token-matches it against torrent
    // titles, so the full title often fails (punctuation/romanization differs, e.g.
    // "Odekakechuu" vs "Odekake-chuu"). Try a cascade of candidates, most likely to
    // match first: episode number (API extracts it as an episode filter), then
    // distinctive keywords most likely left unchanged in release titles.
    let ep_hint = if item.episode >= 1 {
        Some(format!("{:02}", item.episode))
    } else {
        None
    };
    let romaji_kws = neko_keywords(romaji);
    let english_kws = item
        .title_english
        .as_deref()
        .map(neko_keywords)
        .unwrap_or_default();

    let mut candidates: Vec<String> = Vec::new();
    if best_media.is_some() {
        // media matched: episode hint first, then custom names (exact match wins),
        // then keyword combos scoped by media_id
        if let Some(e) = &ep_hint {
            candidates.push(e.clone());
        }
        for name in &custom_names {
            if let Some(e) = &ep_hint {
                candidates.push(format!("{name} {e}"));
            }
            candidates.push(name.clone());
        }
        for kws in [&romaji_kws, &english_kws] {
            for n in [3usize, 2, 1] {
                let take = kws.iter().take(n).cloned().collect::<Vec<_>>();
                if take.is_empty() {
                    continue;
                }
                let mut q = take.join(" ");
                if let Some(e) = &ep_hint {
                    q = format!("{q} {e}");
                }
                candidates.push(q);
            }
        }
        candidates.push(String::new()); // last resort: all torrents for the media
    } else {
        // no media match: custom names first (exact release naming), then keywords
        for name in &custom_names {
            if let Some(e) = &ep_hint {
                candidates.push(format!("{name} {e}"));
            }
            candidates.push(name.clone());
        }
        for kws in [&romaji_kws, &english_kws] {
            for n in [3usize, 2, 1] {
                let take = kws.iter().take(n).cloned().collect::<Vec<_>>();
                if take.is_empty() {
                    continue;
                }
                let mut q = take.join(" ");
                if let Some(e) = &ep_hint {
                    q = format!("{q} {e}");
                }
                candidates.push(q);
            }
        }
    }
    // dedupe + cap to keep API calls bounded
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert(c.clone()));
    candidates.truncate(6);

    // build API filter params (shared across candidates)
    let base_params = || {
        let mut params: Vec<(String, String)> = Vec::new();
        params.push(("sort_by".into(), "seeders".into()));
        params.push(("limit".into(), "50".into()));
        for (key, val) in [
            ("hardsub", filters.hardsub),
            ("batch", filters.batch),
            ("otl", filters.otl),
            ("mtl", filters.mtl),
        ] {
            if let Some(b) = val {
                params.push((key.into(), if b { "true".into() } else { "false".into() }));
            }
        }
        params
    };
    // stage: filters get progressively relaxed so an over-strict filter combo
    // (levels/langs/groups) never results in 0 matches when the torrent exists.
    let mut stages: Vec<Vec<(String, String)>> = Vec::new();
    // stage 1: media_id + levels + langs + group_id (strictest)
    let mut s1 = base_params();
    if let Some(media) = &best_media {
        s1.push(("media_id".into(), media.id.clone()));
    }
    if !filters.levels.is_empty() {
        s1.push((
            "levels".into(),
            filters
                .levels
                .iter()
                .map(|l| l.to_string())
                .collect::<Vec<_>>()
                .join(","),
        ));
    }
    for (key, vals) in [
        ("audio_lang", &filters.audio_lang),
        ("fansub_lang", &filters.fsub_lang),
        ("sub_lang", &filters.sub_lang),
    ] {
        if !vals.is_empty() {
            s1.push((key.into(), vals.join(",")));
        }
    }
    if !include_groups.is_empty() {
        s1.push(("group_id".into(), include_groups.join(",")));
    }
    stages.push(s1);
    // stage 2: drop levels/langs, keep media_id + group_id
    let mut s2 = base_params();
    if let Some(media) = &best_media {
        s2.push(("media_id".into(), media.id.clone()));
    }
    if !include_groups.is_empty() {
        s2.push(("group_id".into(), include_groups.join(",")));
    }
    stages.push(s2);
    // stage 3: drop group_id too, keep media_id
    if let Some(media) = &best_media {
        let mut s3 = base_params();
        s3.push(("media_id".into(), media.id.clone()));
        stages.push(s3);
    }
    // stage 4: no media_id, no group (query only, global search)
    stages.push(base_params());

    let mut torrents = Vec::new();
    let mut used_stage = 0usize;
    'stages: for (si, params) in stages.iter().enumerate() {
        for q in &candidates {
            let mut qp = params.clone();
            if !q.is_empty() {
                qp.push(("query".into(), q.clone()));
            }
            crate::db::append_log(&format!(
                "  neko: stage {} torrents query={q:?} params={qp:?}",
                si + 1
            ));
            match neko.search_torrents(&qp).await {
                Ok(list) => {
                    crate::db::append_log(&format!(
                        "  neko: stage {} -> {} results",
                        si + 1,
                        list.len()
                    ));
                    torrents = list;
                    if !torrents.is_empty() {
                        used_stage = si + 1;
                        break 'stages;
                    }
                }
                Err(e) => {
                    crate::db::append_log(&format!("  neko: stage {} error: {e}", si + 1));
                }
            }
        }
    }
    crate::db::append_log(&format!(
        "  neko: final {} torrents via stage {used_stage} (before episode/exclude filter)",
        torrents.len()
    ));
    // relaxed stages may return other groups: prefer the user's included groups
    // when present, but don't hard-block (stage 1 would have handled strict mode)
    if used_stage >= 3 && !include_groups.is_empty() {
        let preferred: Vec<_> = torrents
            .iter()
            .filter(|t| {
                t.groups.as_ref().is_some_and(|gs| {
                    gs.iter().any(|g| {
                        include_groups
                            .iter()
                            .any(|i| i.eq_ignore_ascii_case(&g.id) || i.eq_ignore_ascii_case(g.name.as_deref().unwrap_or("")))
                    })
                })
            })
            .collect();
        if !preferred.is_empty() {
            crate::db::append_log(&format!(
                "  neko: kept {} preferred-group torrents (stage {used_stage})",
                preferred.len()
            ));
            torrents = preferred.into_iter().cloned().collect();
        }
    }
    // last-resort query-less search returned all episodes of the media: keep only
    // torrents whose title mentions the target episode number
    if let (Some(e), true) = (ep_hint.as_deref(), torrents.len() > 1) {
        let wants_batch = filters.batch == Some(true);
        if !wants_batch {
            torrents.retain(|t| title_mentions_episode(&t.title, e));
        }
    }

    // post-filter: exclude groups the user doesn't want (API has no exclude param)
    let rows: Vec<ReleaseRow> = torrents
        .into_iter()
        .filter(|t| {
            if exclude_groups.is_empty() {
                return true;
            }
            !t.groups.as_ref().is_some_and(|gs| {
                gs.iter().any(|g| {
                    exclude_groups
                        .iter()
                        .any(|e| e.eq_ignore_ascii_case(&g.id) || e.eq_ignore_ascii_case(g.name.as_deref().unwrap_or("")))
                })
            })
        })
        .filter_map(|t| neko_torrent_to_row(&neko.base_url(), t, item))
        .collect();
    let patterns = db.release_filters_get(item.anilist_id);
    let mut rows = rows;
    if !patterns.is_empty() {
        let before = rows.len();
        rows.retain(|r| {
            let lower = r.title.to_lowercase();
            !patterns.iter().any(|p| lower.contains(&p.to_lowercase()))
        });
        if rows.len() != before {
            crate::db::append_log(&format!(
                "  neko: custom filters dropped {} of {before} releases ({patterns:?})",
                before - rows.len()
            ));
        }
    }
    // global title filters (same ones Nyaa uses) also gate nekoBT results
    if nyaa_filters.enabled
        && (!nyaa_filters.include.is_empty() || !nyaa_filters.exclude.is_empty())
    {
        let before = rows.len();
        rows.retain(|r| {
            passes_title_filters(&r.title, &nyaa_filters.include, &nyaa_filters.exclude)
        });
        if rows.len() != before {
            crate::db::append_log(&format!(
                "  neko: global title filters dropped {} of {before} releases",
                before - rows.len()
            ));
        }
    }
    let rows = apply_quality_prefs(rows, &db.quality_prefs_get(item.anilist_id), "neko");
    Ok(rows)
}

/// Per-title quality preference: patterns are tried in order and the first
/// pattern with at least one match keeps only matching releases; when no
/// pattern matches anything, every release passes through untouched.
fn apply_quality_prefs(rows: Vec<ReleaseRow>, prefs: &[String], from: &str) -> Vec<ReleaseRow> {
    if prefs.is_empty() {
        return rows;
    }
    for p in prefs {
        let needle = p.trim().to_lowercase();
        if needle.is_empty() {
            continue;
        }
        let kept: Vec<ReleaseRow> = rows
            .iter()
            .filter(|r| r.title.to_lowercase().contains(&needle))
            .cloned()
            .collect();
        if !kept.is_empty() {
            crate::db::append_log(&format!(
                "  {from}: quality preference \"{p}\" kept {} of {} releases",
                kept.len(),
                rows.len()
            ));
            return kept;
        }
    }
    crate::db::append_log(&format!(
        "  {from}: quality preferences {prefs:?} matched nothing, keeping all {} releases",
        rows.len()
    ));
    rows
}

/// Distinctive keywords from a title, longest first, most likely to appear
/// unchanged in release titles (filters out particles/connectors and numbers).
fn neko_keywords(title: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "the", "of", "and", "for", "with", "from", "into", "over", "under", "e", "no", "da",
        "de", "do", "na", "ni", "wa", "ga", "to", "wo", "mo", "ja", "season", "part", "vol",
    ];
    let mut words: Vec<String> = nyaa::normalize(title)
        .split_whitespace()
        .filter(|w| w.len() >= 4 && !STOP.contains(w) && !w.chars().all(|c| c.is_ascii_digit()))
        .map(|s| s.to_string())
        .collect();
    words.sort_by(|a, b| b.len().cmp(&a.len()));
    words.dedup();
    words.truncate(5);
    words
}

/// Whether a release title mentions the given zero-padded episode number,
/// e.g. "E07", "S02E07", "- 07", "[07]", " 07 ".
fn title_mentions_episode(title: &str, ep: &str) -> bool {
    let t = title.to_lowercase();
    let e = ep.to_lowercase();
    let variants = [format!("e{e}"), format!("- {e}"), format!("[{e}]"), format!(" {e} ")];
    variants.iter().any(|v| t.contains(v))
}

fn media_score(m: &neko::NekoMediaResult, romaji: &str, english: Option<&str>) -> f64 {
    let sim = m.similarity.unwrap_or(0.0);
    let base = sim.max(0.0) * 0.7;
    let mut score = base;
    let titles: Vec<&str> = std::iter::once(m.title.as_str())
        .chain(
            m.alternate_titles
                .as_ref()
                .map(|a| a.iter().map(|s| s.as_str()).collect::<Vec<_>>())
                .unwrap_or_default(),
        )
        .collect();
    for src in [romaji, english.unwrap_or("")].iter().filter(|s| !s.is_empty()) {
        let n = nyaa::normalize(src);
        for t in &titles {
            let nt = nyaa::normalize(t);
            if nt.is_empty() {
                continue;
            }
            let overlap = n
                .split_whitespace()
                .filter(|w| nt.split_whitespace().any(|tw| tw == *w))
                .count();
            let ratio = overlap as f64 / nt.split_whitespace().count().max(1) as f64;
            if ratio > 0.5 {
                score = score.max(0.85 + (ratio - 0.5));
            } else {
                score = score.max(base + ratio * 0.3);
            }
        }
    }
    score.min(1.0)
}

fn neko_torrent_to_row(
    base: &str,
    t: NekoTorrent,
    item: &ScheduleRow,
) -> Option<ReleaseRow> {
    let seeders: i64 = t.seeders.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
    let leechers: i64 = t.leechers.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
    let size = t
        .filesize
        .as_deref()
        .and_then(|s| s.parse::<u64>().ok())
        .map(human_size);
    Some(ReleaseRow {
        id: 0,
        anilist_id: item.anilist_id,
        episode: item.episode,
        title: t.title.clone(),
        url: Some(format!("{}/torrents/{}", base.trim_end_matches('/'), t.id)),
        magnet: t.magnet.or(t.private_magnet),
        torrent: Some(format!(
            "{}/api/v1/torrents/{}/download",
            base.trim_end_matches('/'),
            t.id
        )),
        size,
        seeders,
        leechers,
        found_at: Some(chrono::Utc::now().timestamp()),
        seen: 0,
    })
}

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{bytes} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}
async fn search_nyaa(
    nyaa: &Nyaa,
    db: &Db,
    item: &ScheduleRow,
    romaji: &str,
    filters: &NyaaFilters,
    include_groups: &[String],
) -> Result<Vec<ReleaseRow>, String> {
    let custom_names = db.search_names_get(item.anilist_id);
    // token pool for matching: custom search names matter most (they exist
    // precisely because AniList titles often differ from release titles), and
    // the AniList tokens stay as fallback evidence
    let mut tokens: Vec<String> = custom_names
        .iter()
        .flat_map(|n| nyaa::series_tokens(n, None, None))
        .collect();
    for tok in nyaa::series_tokens(
        romaji,
        item.title_english.as_deref(),
        item.title_native.as_deref(),
    ) {
        if !tokens.contains(&tok) {
            tokens.push(tok);
        }
    }
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let mut query_count = 0usize;
    let mut queries: Vec<String> = Vec::new();
    if item.episode >= 1 {
        // episoded custom names, most specific first
        for name in &custom_names {
            queries.push(format!("{name} {}", item.episode));
        }
    }
    // bare custom names: shorter/fuzzier titles ("Chii Fuyo" vs "- 02") still
    // surface the episode list, matches_episode narrows it afterwards
    queries.extend(custom_names.iter().cloned());
    queries.extend(nyaa::search_queries(
        romaji,
        item.title_english.as_deref(),
        item.title_native.as_deref(),
        item.episode,
    ));
    let mut dedup = std::collections::HashSet::new();
    queries.retain(|q| dedup.insert(q.clone()));
    for query in queries {
        query_count += 1;
        crate::db::append_log(&format!("  nyaa: query={query:?} tokens={tokens:?}"));
        match nyaa.search(&query).await {
            Ok(list) => {
                crate::db::append_log(&format!("  nyaa: -> {} results", list.len()));
                let matched: Vec<_> = list
                    .into_iter()
                    .filter(|r| nyaa::matches_episode(&r.title, &tokens, item.episode))
                    .collect();
                if !matched.is_empty() {
                    results = matched;
                    break;
                }
            }
            Err(e) => {
                crate::db::append_log(&format!("  nyaa: error: {e}"));
            }
        }
    }

    let found_before = results.len();
    let mut filtered = nyaa.apply_filters(results, filters);
    // Preferred fansub groups apply to nyaa results too: a group shows up as
    // a title tag (e.g. "[Erai-raws] Chii Fuyo - 02 [1080p …]"), so keep only
    // releases whose title carries one of the preferred groups. This is strict —
    // releases from other groups are dropped even when nothing else matches.
    if !include_groups.is_empty() {
        let group_setting = db.settings_get("neko_group_names");
        let mut tags: Vec<String> = Vec::new();
        for id in include_groups {
            if let Some(name) = group_setting
                .as_ref()
                .and_then(|v| v.get(&id))
                .and_then(|s| s.as_str())
            {
                if name.len() >= 3 {
                    tags.push(name.to_string());
                }
            }
            if id.len() >= 3 {
                tags.push(id.clone());
            }
        }
        tags.retain(|t| !t.trim().is_empty());
        tags.sort();
        tags.dedup();
        if !tags.is_empty() {
            let normalized_tags: Vec<String> =
                tags.iter().map(|t| nyaa::normalize(t)).collect();
            let before = filtered.len();
            filtered.retain(|r| {
                let t = nyaa::normalize(&r.title);
                normalized_tags.iter().any(|g| t.contains(g.as_str()))
            });
            crate::db::append_log(&format!(
                "  nyaa: preferred groups kept {} of {before} releases (tags {normalized_tags:?})",
                filtered.len()
            ));
        }
    }
    crate::db::append_log(&format!(
        "  nyaa: queries ran={} found={} after_filters={}",
        query_count,
        found_before,
        filtered.len()
    ));
    let mut rows: Vec<ReleaseRow> = filtered
        .into_iter()
        .map(|r| ReleaseRow {
            id: 0,
            anilist_id: item.anilist_id,
            episode: item.episode,
            title: r.title.clone(),
            url: r.url.clone(),
            magnet: r.magnet.clone(),
            torrent: r.torrent.clone(),
            size: r.size.clone(),
            seeders: r.seeders,
            leechers: r.leechers,
            found_at: Some(chrono::Utc::now().timestamp()),
            seen: 0,
        })
        .collect();
    let patterns = db.release_filters_get(item.anilist_id);
    if !patterns.is_empty() {
        let before = rows.len();
        rows.retain(|r| {
            let lower = r.title.to_lowercase();
            !patterns.iter().any(|p| lower.contains(&p.to_lowercase()))
        });
        if rows.len() != before {
            crate::db::append_log(&format!(
                "  nyaa: custom filters dropped {} of {before} releases ({patterns:?})",
                before - rows.len()
            ));
        }
    }
    let rows = apply_quality_prefs(rows, &db.quality_prefs_get(item.anilist_id), "nyaa");
    Ok(rows)
}

async fn insert_results(
    app: &AppHandle,
    db: &Db,
    item: &ScheduleRow,
    rows: Vec<ReleaseRow>,
    auto: bool,
) -> Result<usize, String> {
    let found = rows.len();
    for row in rows {
        let seen = db.schedule_has_been_asked(item.anilist_id, item.episode);
        let id = db.release_insert(&row);
        if id > 0 && !seen {
            db.schedule_mark_asked(item.anilist_id, item.episode);
            notify_release(app, &row);
        }
    }
    db.schedule_mark_searched(item.anilist_id, item.episode);
    app.emit(
        "release-search-done",
        json!({
            "anilistId": item.anilist_id,
            "episode": item.episode,
            "found": found,
            "auto": auto,
        }),
    )
    .ok();
    Ok(found)
}

fn notify_release(app: &AppHandle, r: &ReleaseRow) {
    let payload = json!({
        "anilistId": r.anilist_id,
        "episode": r.episode,
        "title": r.title,
        "magnet": r.magnet,
        "size": r.size,
        "seeders": r.seeders,
    });
    app.emit("release-found", payload).ok();

    let notify = app
        .try_state::<crate::scheduler::AppState>()
        .and_then(|st| st.db.settings_get("notify"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if notify {
        let show = |body: String| {
            use tauri_plugin_notification::NotificationExt;
            let _ = app
                .notification()
                .builder()
                .title("New release found")
                .body(body)
                .show();
        };
        show(format!("{} — {}", r.title, r.size.clone().unwrap_or_default()));
    }
}
