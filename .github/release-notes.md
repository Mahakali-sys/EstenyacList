# EstenyacList {{VERSION}}

Built from commit `{{COMMIT}}` by the release workflow on GitHub Actions.

This version fixes pulling from AniList and polishes the post-pull cover cache pass.

## Hotfix: AniList pull and cover caching

- AniList pulls no longer fail with `Field "customLists" of type "Json" must not have a sub selection`. The pull query now requests the JSON scalar directly, and custom-list membership is read from the returned name-to-enabled map.
- The cover pass that runs after a pull now emits progress through the same `covers-progress` event as the manual cover action.
- Cover caching skips the 25 ms CDN pause for covers that are already on disk, so repeat pulls over a large cached list no longer spend about a minute on that delay.

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
