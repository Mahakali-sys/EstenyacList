# EstenyacList {{VERSION}}

Built from commit `{{COMMIT}}` by the release workflow on GitHub Actions.

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

EstenyacList is licensed under the GNU General Public License, version 3 or later. The bundled libmpv is licensed under the GNU General Public License, version 2 or later. License texts and the full third-party attribution list are included in the portable ZIP and in the repository.
