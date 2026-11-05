# EstenyacList {{VERSION}}

Built from commit `{{COMMIT}}` by the release workflow on GitHub Actions.

## Hotfix

- Updated Vite to 7.3.7 and source-map-js to 1.2.2, closing five Dependabot advisories in the frontend build tooling (including a high-severity Windows argument-injection issue in `launch-editor`).
- Updated rustls to 0.23.46, closing four Dependabot advisories in the TLS stack used by reqwest and rqbit.
- The remaining Dependabot alert for `glib` covers the Linux GTK stack only. This release is a Windows build and does not compile or ship glib; the alert stays open until Tauri moves to a newer gtk-rs generation.

The localization changes from 0.1.2 are unchanged:

- The app defaults to English with US Eastern time (`America/New_York`).
- Settings → General has a timezone picker with every IANA timezone and a filter box.
- Airing days, airing times, and countdowns follow the selected timezone.
- Dates, sync timestamps, stats months, and the activity heatmap follow the selected timezone.
- Activity days are recorded and the airing schedule is refreshed around midnight in the selected timezone.

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
