# SB3 Tools

Browser-only utilities for **Scratch / TurboWarp `.sb3`** projects: three
compressors and one analyzer. Everything runs inside the tab — there is no
upload, no install, and no build step for the site itself.

**Live site:** <https://pixelnest256.github.io/sb3-tools/>
· Japanese: <https://pixelnest256.github.io/sb3-tools/ja/>

## The tools

| Path | Tool | What it does |
| --- | --- | --- |
| `/sb3/` | **SB3 Compressor** | Shrinks `project.json` without changing behavior. Costumes and sounds are copied through untouched. |
| `/media/` | **Media Compressor** | Re-encodes the costumes and sounds (PNG, JPEG, SVG, WAV, MP3). `project.json` is left byte-for-byte identical. |
| `/full/` | **Full Compressor** | Runs both passes on one file and repacks once. |
| `/analyzer/` | **Analyzer** | Reports where the bytes and blocks go, with warnings against Scratch's upload limits. Writes nothing. |

Each tool has an English page and a Japanese page (`…/ja/`). Use `docs/sb3/`,
`docs/media/`, `docs/full/`, and `docs/analyzer/` when editing.

## What the compressors do

### Project pass — `project.json` (behavior-preserving)

- **Rename** block IDs, variable/list names, broadcast names, and custom-block
  proccodes/arguments to short generated IDs.
- **Drop** default-valued fields the VM restores, hidden input defaults, unused
  variables and lists, unreachable blocks/comments, uncalled definitions, and
  dead broadcasts.
- **Restructure** repeated or near-duplicate code into shared custom blocks,
  consecutive repeats into `repeat` loops, empty `if-else` into `if`, and
  single-use non-warp definitions inline.
- **Fold** constant arithmetic and propagate stores that never change.
- **Minify** the JSON and repack the zip.

The `/sb3/` page groups these passes into presets — **JSON cleanup only**,
**No visible change**, **Code cleanup**, **Code optimization**, and **Maximum** —
and switches to **Custom** as soon as an individual option is changed.

Every pass is kept only when the serialized JSON actually gets smaller, and the
markers the Scratch VM relies on (an explicit `parent: null` and an
end-of-stack `next: null`) are preserved.

### Media pass — costumes and sounds (lossy)

| Asset | Treatment |
| --- | --- |
| PNG | Palette quantisation (2–256 colours, optional dithering) written as an indexed PNG, then a lossless **OxiPNG** pass. Transparency is preserved. |
| JPEG | **MozJPEG** re-encode at a chosen quality. Pixel dimensions never change, so rotation centres stay valid. |
| SVG | **SVGO** optimisation. |
| WAV | Band-limited resampling, optional mono downmix, or transcoding to **MP3**. |
| MP3 | ID3 tag stripping, or re-encode at a lower bitrate (mpg123 → LAME). |

An asset is replaced only when the new bytes are actually smaller. File names
and formats never change — so `project.json` stays what it was — **unless** a
WAV sound is converted to MP3, in which case that asset's `md5ext` and
`dataFormat` are updated.

Media compression is spread across a pool of nested Web Workers (one per CPU
core, up to 12), so projects with many costumes finish several times faster; it
falls back to a single worker when nested workers are unavailable.

### Analyzer

- the **`project.json` size**, with a bar against Scratch's 5 MB limit;
- **media bytes and asset counts per sprite** (share of bytes and share of
  count), a warning for any asset over the 10 MB per-asset limit, a
  largest-assets table, and a list of unreferenced files;
- **block counts per sprite** with each sprite's share of the total.

## Repository layout

```
docs/                 the whole site (GitHub Pages serves this folder)
  index.html          landing page (English)      · stylesheet: home.css
  ja/index.html       landing page (Japanese)
  sb3/                SB3 Compressor   (+ ja/)
  media/              Media Compressor (+ ja/)
  full/               Full Compressor  (+ ja/)
  analyzer/           Analyzer         (+ ja/)
  .nojekyll           keeps Jekyll away from the folder
  <tool>/             index.html · app.js · worker.js · styles.css · …
                      media/ and full/ also carry vendor/ codecs
build/media/          esbuild script that produces the vendored codecs (dev only)
build/check/          regression checks for the project pass (dev only)
LICENSE               MIT
```

Only `build/` needs Node. The site is plain static files.

## Regression checks

`build/check/compress-invariants.mjs` compresses a small synthetic project and
asserts the invariants the Scratch VM and its editor rely on: every block
mutation keeps `tagName` and `children`, top-level blocks keep
`parent: null`, reachable stack ends keep `next: null`, no input or field points
at something that was deleted, and initial-value blanking only happens when it
saves a meaningful amount of JSON. Run it after touching
`docs/sb3/compressor.js` or `docs/full/project.js`:

```console
node build/check/compress-invariants.mjs
```

## Vendored codecs

`docs/media/vendor/` and `docs/full/vendor/` hold prebuilt browser bundles
(plain IIFE scripts, loaded lazily). They are committed, so a normal checkout
needs nothing else.

| Bundle | Library | License |
| --- | --- | --- |
| `jpeg.js` + `mozjpeg_enc.wasm` | @jsquash/jpeg — MozJPEG | Apache-2.0 |
| `oxipng.js` + `oxipng_bg.wasm` | @jsquash/oxipng — OxiPNG | Apache-2.0 |
| `mp3.js` | wasm-media-encoders — LAME | MIT wrapper; LAME is LGPL-2.1 |
| `mp3dec.js` | mpg123-decoder — mpg123 | MIT wrapper; mpg123 is LGPL-2.1 |
| `svgo.js` | SVGO | MIT |

See `docs/media/vendor/LICENSE.md` for details. To rebuild them:

```console
cd build/media
npm install
node build.mjs
```

## Preview locally

```console
python -m http.server 8000 --directory docs
```

Then open <http://localhost:8000/>. Serving over HTTP is recommended, because
the Web Worker keeps the page responsive while a project is compressed; opening
the files directly from disk also works, but the page then compresses in the
main tab instead.

## Publishing

GitHub Pages is set to **Deploy from a branch → `main` / `docs`**. Push to
`main` and the site rebuilds at
`https://<user>.github.io/sb3-tools/` (Japanese at `/ja/`).

## Notes & caveats

- **Media compression is lossy and irreversible.** Always keep a copy of the
  original `.sb3`. The project pass is one-way too: original IDs and names are
  not recoverable from the output.
- Scratch's upload limits are 5 MB for `project.json` and 10 MB per asset; the
  analyzer flags anything over those. There is no limit on the number of assets.
- The PNG lossless pass (OxiPNG) is the slowest step and is off by default; the
  toggle trades a little speed for roughly 10% smaller PNGs.
- Audio: Scratch only plays WAV and MP3, so WAV is either resampled or
  transcoded to MP3 — never to a format Scratch cannot load.
- Opening a page from disk (`file://`) disables Web Workers, so the tools fall
  back to running in the main tab.

## License

Distributed under the [MIT License](LICENSE).
