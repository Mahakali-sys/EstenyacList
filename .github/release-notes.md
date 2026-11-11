# EstenyacList {{VERSION}}

Built from commit `{{COMMIT}}` by the release workflow on GitHub Actions.

## Hotfix: manga imports and scoring

- MyAnimeList manga exports now import. The parser previously recognized only anime field names, so a `mangalist_*.xml` file reported zero entries and imported nothing.
- Manga entries now carry over read chapters, score, reading status, start and finish dates, notes, and reread counts.
- MAL stores the total number of reads in `my_times_read` and includes the first read. The app stores rereads only, so an imported value of `1` becomes `0` rereads and `3` becomes `2`.
- MAL XML export now writes manga-specific elements (`manga_mangadb_id`, `manga_title`, `my_read_chapters`, `my_times_read`, and related fields) instead of anime fields, so manga lists round-trip correctly with MAL and other list tools.
- The Add Manga button now opens search on the Manga tab. Manga search, adding, progress updates, status changes, scores, dates, notes, and rereads all work against the manga list.
- Anime and manga covers are cached in separate directories (`cache/images/anime` and `cache/images/manga`). The existing flat cache and legacy JPEG covers are migrated automatically on the next launch, and re-downloading covers stores each type in its own directory.

## Assets

- `EstenyacList_{{VERSION}}_x64-setup.exe`: per-user installer. It includes libmpv, so the built-in player works without extra setup.
- `EstenyacList_{{VERSION}}_x64-portable.zip`: portable build. Extract it to a writable folder before running.
- `libmpv-2.dll`: the exact libmpv binary bundled in the installer and portable build, provided separately for source builds.
- `SHA256SUMS.txt`: SHA-256 checksums for the other assets.

## Requirements

- Windows 10 or Windows 11, x64.
- Microsoft Edge WebView2 Runtime. It is already installed on current Windows 10 and Windows 11 systems.
- Optional: `mpv.exe` for the external player fallback. The bundled libmpv player does not need it.

The build is not code-signed. Windows SmartScreen may show a warning on first launch.

## Verification

Check the downloaded files against `SHA256SUMS.txt`:

```powershell
Get-FileHash .\EstenyacList_{{VERSION}}_x64-setup.exe -Algorithm SHA256
```

The build is not bit-for-bit reproducible. Rebuilding the same commit can produce different hashes, so verify against the checksums attached to this release rather than rebuilding.

## Licenses

EstenyacList is licensed under the GNU General Public License, version 3 or later. The bundled libmpv is a combined work distributed under the GNU General Public License, version 3 or later: mpv itself is GPL-2.0-or-later, and the DLL links FFmpeg built with `--enable-gpl --enable-version3` plus other GPL-2.0-or-later components. License texts and the full third-party attribution list, including native libraries, Rust crates, and npm packages, are included in the installer and portable ZIP and in the repository.

The source for this release is commit `{{COMMIT}}`. The complete corresponding source for that commit is available from the repository owner on request.
