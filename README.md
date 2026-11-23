# SB3 Tools

**English** · [日本語](README.ja.md)

Browser-only utilities for **Scratch / TurboWarp `.sb3`** projects: three
compressors, one analyzer, one validator/repair tool, and a watermark checker. Everything runs
inside the tab — there is no upload, no install, and no build step for the site
itself.

**Live site:** <https://pixelnest256.github.io/sb3-tools/>
· Japanese: <https://pixelnest256.github.io/sb3-tools/ja/>

## The tools

| Path | Tool | What it does |
| --- | --- | --- |
| `/sb3/` | **project.json Compressor** | Shrinks `project.json` without changing behavior. SVG costumes receive a small watermark; other media is copied through untouched. |
| `/media/` | **SB3 Media Compressor** | Re-encodes the costumes and sounds (PNG, JPEG, SVG, WAV, MP3) and adds the SVG watermark after SVGO. `project.json` changes for a format conversion or the watermarked SVG's new asset ID. |
| `/full/` | **SB3 Full Compressor** | Runs both passes on one file and repacks once. |
| `/analyzer/` | **SB3 Analyzer** | Reports where the bytes and blocks go, with warnings against Scratch's upload limits. Writes nothing. |
| `/repair/` | **SB3 Repair** | Strictly validates a project, salvages a broken ZIP or `project.json`, repairs block links, stores, assets and monitors, then writes a loadable `.sb3`. |
| `/watermark/` | **SB3 Watermark Checker** | Reads the SB3 Tools watermark from every SVG costume in a local `.sb3` or a public Scratch project ID: UTC compression time, original project name, tool version, and option flags. Writes only a JSON report. |

Each tool has an English page and a Japanese page (`…/ja/`). Use `docs/sb3/`,
`docs/media/`, `docs/full/`, `docs/analyzer/`, `docs/repair/`, and
`docs/watermark/` when editing. The shared watermark encoder lives in
`docs/watermark.js`; the compressor pages and workers load it from there.

## What the compressors do

### Project pass — `project.json` (behavior-preserving)

- **Rename** block IDs to short generated IDs. Variable and list names,
  plus custom-block proccodes and arguments, are only shortened when the
  matching option is on — with just IDs shortened, every name stays as it was.
  Message display names are always kept: a send may omit its id and the VM
  then matches the receiver by name.
  Store IDs are numbered once across the whole project: a sprite resolves an ID
  in its own map first and then on the stage, so reusing an ID between two
  targets would silently retarget one of them. Names are numbered per scope
  instead. The stage goes first and avoids every name that has to survive
  anywhere, because a stage name is visible from every sprite; sprites then
  avoid the stage's final names. Two sprites may reuse the same local name,
  which is legal in Scratch and saves the most space. Dropping unused stores
  leaves no gaps in either sequence.
- **Keep** monitors by default: the variable or list a monitor shows is neither
  dropped nor renamed, and the monitor keeps its position, so the stage looks
  the same. Turning on "don't keep monitors" (the **Maximum** preset) drops
  hidden monitors, which frees their stores for shortening and removal.
- **Drop** default-valued fields the VM restores, hidden input defaults, unused
  variables and lists, unreachable blocks/comments, uncalled definitions, and
  dead broadcasts. The stage comment TurboWarp reads for its advanced settings
  (the one ending in `// _twconfig_`) is never dropped, even when comment
  stripping is on.
- **Restructure** repeated or near-duplicate code into shared custom blocks,
  consecutive repeats into `repeat` loops, empty `if-else` into `if`, identical
  reporters within one script into temporary variables, and single-use non-warp
  definitions inline. Reporters that read the clock, the date, the keyboard, the
  mouse, or another sprite are only cached inside a "run without screen refresh"
  definition. A subtree containing a `control_stop` ("stop this script" or
  "stop other scripts in sprite") is never moved into a shared block, so the
  stop keeps its original scope.
- **Repeat** duplicate extraction, near-duplicate merging, and reporter reuse
  automatically: those steps re-run on the rewritten code until a pass finds
  nothing new (at most 10 passes). Each pass can expose savings left behind by
  the previous one.
- **Fold** constant arithmetic and propagate stores that never change. Constant numeric comparisons and boolean reporter trees are evaluated too, so constant `if` / `if-else` branches are removed and the selected stack is spliced into place.
- **Minify** the JSON and repack the zip.

The `/sb3/` page and the project-data section of `/full/` group these passes
into presets — **JSON cleanup only**, **No visible change**, **Code cleanup**,
**Code optimization**, **Runtime speed**, and **Maximum** — and switch to
**Custom** as soon as an individual option is changed. On `/full/`, a preset changes only the project
data; the separate media strength stays as selected.

**Runtime speed** enables the same cleanup and asset/store passes as Maximum,
but leaves duplicate extraction, near-duplicate merging, loop conversion, and
reporter caching off. These transformations can add custom-block or loop
dispatches, or replace reporter evaluation with temporary-variable writes and
reads. Single-use inlining, no-op removal, and empty if-else simplification stay
enabled because they do not introduce that extra runtime work.

**Maximum** also enables dead-asset and write-only-store removal, but with a
safety gate: dead assets are removed only when every costume, sound, and sprite
reference is a literal, directly known value; a computed name or an index skips
the whole asset pass. Write-only removal resolves both explicit IDs and
name-only fields, and tracks variables and lists separately when they share an
ID. Starting-value clearing, type normalization, and null-field-ID stripping
stay off even in Maximum; they live in the **Risky** group, which explains that
they rewrite stored data or field shapes and should be tested before use.

Every pass is kept only when the serialized JSON actually gets smaller, and the
markers the Scratch VM relies on (an explicit `parent: null` and an
end-of-stack `next: null`) are preserved.

### Media pass — costumes and sounds

| Asset | Treatment |
| --- | --- |
| PNG | **Palette** quantises to 2–256 colours (optional dithering) and writes an indexed PNG; it is lossy. **Lossless (OxiPNG)** leaves the pixels untouched and keeps the original when OxiPNG cannot shrink it. **Keep original** copies the PNG. Transparency is preserved. |
| JPEG | **MozJPEG** re-encode at a chosen quality. Pixel dimensions never change, so rotation centres stay valid. |
| SVG | **SVGO** optimisation, and in **Palette** mode optionally a palette **PNG** at the same pixel size when the PNG is smaller. Art whose width or height is under 1px is rasterised at 1px, so the PNG is never zero-sized. |
| WAV | Band-limited resampling, optional mono downmix, or transcoding to **MP3**. |
| MP3 | ID3 tag stripping, or re-encode at a lower bitrate (mpg123 → LAME). |

An asset is replaced only when the new bytes are actually smaller. A WAV→MP3
conversion and an SVG→PNG conversion rewrite that asset's `assetId`, `md5ext`,
and `dataFormat` in `project.json`. Watermarking an SVG also rewrites its
`assetId`/`md5ext`, even when the SVG bytes were otherwise unchanged. A rasterised costume keeps its rotation
centre and gains `bitmapResolution: 1`, so Scratch draws it at the same size. If
an SVG cannot be drawn (the raster comes back blank), it is kept as SVG.

SVG rasterising is done by the page, because workers cannot decode SVG: the
worker asks the tab for RGBA pixels and builds the palette PNG itself.

Media compression is spread across a pool of nested Web Workers (one per CPU
core, up to 12), so projects with many costumes finish several times faster; it
falls back to a single worker when nested workers are unavailable.

### Repair

`docs/repair/repair.js` is a standalone engine shared by the page and the Node
checks. It reads the ZIP directly rather than relying only on the central
directory, so it can recover an archive whose EOCD or central directory is
missing. `project.json` goes through a staged JSON recovery (BOM, NUL bytes,
Scratch 2.0 backspace escapes, raw control characters, leading zeroes,
missing/trailing commas, a missing closing quote, a mismatched object bracket,
Python `True`/`False`/`None` literals, a singular `target` key, truncation and
the case-insensitive `Project.json` entry name) before the structural pass.

The structural pass validates and repairs:

- stage presence/order, target fields, layer order and per-target containers;
- dangling `next`, `parent` and input references, input cycles, missing
  `topLevel`/`shadow` flags and invalid top-level primitives;
- undeclared variables, lists and broadcasts (creating them in the correct
  scope), unsafe store IDs, and monitor references;
- custom-block definitions/prototypes/mutations and orphan calls;
- asset metadata, missing or unreadable media (transparent PNG / silent WAV
  placeholders), MD5 asset filenames, costume rotation centres, bitmap
  resolution, and sound rate/sample count;
- extension declarations inferred from block and monitor opcodes.

The repair output is validated again with the same strict checker before the
page offers a download. The checker separates errors (the project cannot be
loaded/edited reliably) from warnings (tolerated by Scratch but worth fixing).
Data cut off the end of a truncated `project.json` cannot be reconstructed;
the report says what was dropped.

### Watermark

All three compressors add a small watermark to every referenced SVG costume
that survives their output. The full pass and the media pass apply it after
SVGO, so the optimiser cannot strip it. It is an invisible `<desc>` element
appended as the last child of the root `<svg>` element: it has no geometry, so
Scratch and TurboWarp never paint it, and a normal project save copies the
asset through unchanged:

```xml
<desc id="sb3tools-watermark">SB3TOOLS-WATERMARK:1:<base64(JSON)></desc>
```

`<desc>` is deliberately used instead of an XML comment or `<metadata>`: the
Scratch SVG sanitizer removes comments, and `scratch-svg-renderer` empties the
contents of `<metadata>` on load. A `<desc>` survives both paths and is also
kept by SVGO's default configuration. The payload is JSON with `s` (schema),
`k` (`project`, `media`, or `full`), `t` (UTC timestamp), `n` (original file
name), `v` (tool version), `o` (project option bits), and, for the media/full
passes, `m` (media option bits). Option bits are packed least-significant-bit
first in the fixed key order exported by `docs/watermark.js`; the project pass
has 26 flags and the media/full passes add 7 media flags. The checker decodes
both groups.

Changing the SVG bytes changes its MD5, so the compressor updates the
`assetId`/`md5ext` of every costume that shared the old asset. An existing
watermark is stripped before a new one is inserted, which makes re-compression
idempotent when the metadata is the same and replaces a stale payload when it
is not. The full and media passes apply the watermark after media compression, so
SVGO cannot remove it in those passes.

The watermark survives a normal Scratch / TurboWarp save. A tool that rewrites
the SVG itself with an aggressive custom SVGO config could still remove a
`<desc>`; the checker reports marked, unmarked, invalid, and mixed payloads
without modifying the project. Older watermarks stored as XML comments are
still readable, and are replaced by the `<desc>` form on the next compression.

The checker also accepts a public Scratch project ID or URL. It resolves the
project token through TurboWarp's public trampoline proxy, downloads
`project.json` and the referenced SVG assets from Scratch, and runs the same
scan. Unshared projects are rejected; the project token is never written to the
JSON report.

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
  sb3/                project.json Compressor (+ ja/)
  media/              SB3 Media Compressor    (+ ja/)
  full/               SB3 Full Compressor     (+ ja/)
  analyzer/           SB3 Analyzer            (+ ja/)
  repair/             SB3 Repair              (+ ja/)
  watermark/          SB3 Watermark Checker   (+ ja/)
  watermark.js        shared watermark encoder/decoder
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
saves a meaningful amount of JSON.

`build/check/goboscript-rules.mjs` covers constant-condition folding and stack rewiring in both the project-only and Full Compressor engines. Pass a real `.sb3` path as the first argument or set `GOBOSCRIPT_SB3` to enable the real-project integration check; without either, only the synthetic tests run.

`build/check/goboscript-runtime.mjs` executes original and folded projects in Scratch VM and compares speech events, variables, lists, and sprite state. It covers `if` / `if-else`, nested boolean reporters, dynamic reporters, and numeric shadow types. Install `@scratch/scratch-vm` in a separate test directory, then set `NODE_PATH` to that directory's `node_modules`. An optional real `.sb3` fixture can be supplied with `GOBOSCRIPT_SB3` or as the first argument. The comparison runs for a bounded interval with a deterministic random seed; it is a regression test, not a proof of equivalence for every possible input or execution path.

```console
npm install --prefix /tmp/sb3-tools-runtime @scratch/scratch-vm
NODE_PATH=/tmp/sb3-tools-runtime/node_modules node build/check/goboscript-runtime.mjs
NODE_PATH=/tmp/sb3-tools-runtime/node_modules GOBOSCRIPT_SB3=/path/to/project.sb3 node build/check/goboscript-runtime.mjs
```

`build/check/watermark-invariants.mjs` checks the watermark encoder against
Node's MD5, the fixed option-bit order, the asset-ID/MD5 rewrite, replacement
instead of duplication, idempotence, and the project compressor's final SVG
bytes.

Run these checks after touching the compressor or `docs/watermark.js`:

```console
node build/check/compress-invariants.mjs
node build/check/goboscript-rules.mjs
node build/check/watermark-invariants.mjs
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

- **Palette PNG compression is lossy and irreversible.** Always keep a copy of
  the original `.sb3`. The project pass is one-way too: original IDs and names
  are not recoverable from the output. SVG→PNG is available only in PNG
  **Palette** mode and reduces a vector costume to a palette PNG at its current
  pixel size — turn it off to keep vector art crisp at any zoom.
- Scratch's upload limits are 5 MB for `project.json` and 10 MB per asset; the
  analyzer flags anything over those. There is no limit on the number of assets.
- **Lossless (OxiPNG)** is the slowest PNG mode. It never quantises colours and
  keeps the original PNG when optimization does not make it smaller. Use it when
  image pixels must remain unchanged.
- Audio: Scratch only plays WAV and MP3, so WAV is either resampled or
  transcoded to MP3 — never to a format Scratch cannot load.
- Opening a page from disk (`file://`) disables Web Workers, so the tools fall
  back to running in the main tab.

## License

Distributed under the [MIT License](LICENSE).
