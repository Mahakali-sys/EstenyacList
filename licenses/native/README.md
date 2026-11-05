# Native license texts

This directory contains the license texts for the native libraries that are
statically linked into `libmpv-2.dll`, plus notes for public-domain components
and the AviSynth and LLVM exceptions.

The mapping from each component to its license text is in
`scripts/native-dependencies.json`. The generated
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) contains the readable
component table and license index.

## Sources

Most texts are the canonical SPDX license texts from https://spdx.org/licenses/.
Component-specific variants were taken from the upstream projects:

- `AOM.txt`: https://aomedia.googlesource.com/aom/+/refs/heads/main/LICENSE
- `HarfBuzz.txt`: https://github.com/harfbuzz/harfbuzz/blob/main/COPYING
- `fontconfig.txt`: https://gitlab.freedesktop.org/fontconfig/fontconfig/-/blob/main/COPYING
- `libxml2.txt`: https://github.com/GNOME/libxml2/blob/master/Copyright
- `curl.txt`: https://github.com/curl/curl/blob/master/COPYING
- `Libpng.txt`: https://github.com/pnggroup/libpng/blob/libpng16/LICENSE
- `IJG.txt`: https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md
- `bzip2-1.0.6.txt`: https://gitlab.com/bzip2/bzip2/-/blob/master/LICENSE
- `FTL.txt`: https://gitlab.freedesktop.org/freetype/freetype/-/blob/master/docs/FTL.TXT
- `Public-Domain.txt`: attribution note for public-domain components
- `AviSynth-exception.txt`: https://github.com/AviSynth/AviSynthPlus
- `LLVM-exception.txt`: https://github.com/llvm/llvm-project/blob/main/LICENSE.TXT

The GPL-2.0 and GPL-3.0 texts are kept at `licenses/GPL-2.0.txt` and `LICENSE`
in the repository root rather than duplicated here.
