# Style System and Engine Plan

Status: design proposal, not implemented. Written 2026-11-07 on top of the unified catalog (`apps/web/src/stylePresets.ts`, 8 styles).
Inputs: `docs/style-library-research-2026-11.md` and the presentation techniques the user's relay summarised (double mat, bevel core, drop border, editorial systems, social canvases, film rebate).

This document defines (1) a visual style language organised by **construction**, (2) the engine model that can express it without per-style code, (3) how the TS preview and the Python renderer stay identical, (4) a phased roadmap, and (5) risks, non-goals and the decisions the user needs to make.

Out of scope by instruction: new single/dual-track, logo-position, size-level or swatch variants of today's footer bar. Those are parameters, not styles.

---

## 0. Summary

- **Ten style families**, each defined by how the picture is constructed: Information Bar (today's 8 styles), Passe-partout, Editorial, Overlay, Social Canvas, Analog Film, Print Object, Fine-art Edition, CJK Mounting, and Colour-derived.
- **One engine idea**: a style is a **stack of layers** on a **canvas with a fixed geometry model**. Every layer is built from about a dozen primitives: box, fill, stroke, rule, shadow, text block, image asset, pattern, texture, edge mask, palette swatch and clip.
- The layout engines in TS and Python stop emitting "elements" and emit a **display list**: an ordered list of drawing operations in integer pixels. The display list is the contract between the two languages. Layout parity is exact; paint parity is checked against a tolerance.
- **Six milestones**, each unlocking whole families:
  1. Foundations: units, display list, metrics and the parity harness.
  2. Gallery.
  3. Editorial and typography.
  4. Overlays.
  5. Social canvas and colour.
  6. Film and material surfaces.
- **The first visible proof** is milestone 2: a double mat with a white bevel core and a weighted bottom, rendered identically at print size by both renderers.
- **Decisions for the user** are in §7. The biggest is whether layout stays implemented twice, in TS and Python, or Python becomes the only layout engine.

---

## 1. Principles

1. **A style is a construction, not a parameter set.** Two styles belong to different families when the *relationship between photo and frame* differs: the photo surrounded by a mat, type over the photo, the photo placed on a fixed social canvas, the photo as a film frame. Changing colours or sizes inside one construction makes a variant, not a new style.
2. **Composable primitives, no per-style code paths.** A new style should be data in the catalog. If a style needs code, the missing piece becomes a general primitive that other styles can use too.
3. **Everything scales with the photo.** Lengths are ratios of a reference edge, so a 24 MP and a 100 MP file produce the same look. Absolute pixels are allowed only where a physical print size is declared.
4. **The ordinary user sees a style, a few content toggles and a few knobs.** Each style declares which knobs it exposes. The full engine stays available to advanced editing and to style authors, never as the default control surface.
5. **Two renderers, one truth.** Geometry is computed identically in both languages and frozen by fixtures. Pixels may differ only by rasterisation noise.

---

## 2. Style taxonomy

Each family lists: the visual idea · why it works and for what photography · compositional structure · typography · material/surface · named example styles. Proportions are starting points for design review, expressed in **se** (fraction of the photo's short edge) unless stated.

### F0 — Information Bar *(exists today)*
- **Idea**: a solid band attached to one edge carries camera and shot data, often with a brand mark and divider.
- **For**: everyday sharing and gear-oriented communities. This is the dominant "camera watermark" look in China.
- **Structure**: a band on the bottom, left or right edge, in one or two tracks; logo at start, centre or end.
- **Status**: fully covered by today's 8 styles. It stays as the baseline family and **no new styles are planned here**. It does benefit from the new typography and fields.

### F1 — Passe-partout / Gallery Mat
- **Idea**: the photo is mounted behind a window cut in a mat board. Space, a thin line and a weighted bottom create depth and calm.
- **Why beautiful**:
  - Generous space isolates the image.
  - A thin bevel or core line separates image from mat without competing with it.
  - A slightly heavier bottom counters optical sag, so the image appears centred.
  - A second, inner mat ("reveal") adds depth and a controlled accent colour taken from the photo.
- **For**: landscape, fine art, black and white, architecture, portfolio and print previews.
- **Structure** (outside → inside):
  1. Canvas or outer mat colour.
  2. Optional outer keyline.
  3. Mat window with margins of about 0.10–0.25 se. The bottom is weighted ×1.1–1.4 ("drop").
  4. Optional second mat revealed as an inner band of 0.006–0.015 se.
  5. Bevel core line of 0.002–0.004 se, white core or black core, with a faint shading gradient on one side to suggest the 45° cut.
  6. The photo.
  7. An optional caption on the lower margin, locked to a register line (for example 38% of the bottom margin's height from the window).
- **Typography**: small, quiet captions such as a text serif at 0.012–0.016 se, or tracked small caps in sans. Title in roman, details in a lighter tone.
- **Material**: smooth cotton or museum board in warm white, cream, or charcoal/black. An optional subtle paper texture.
- **Examples**:
  - *Museum Mat* (single mat, drop bottom, white core)
  - *Double Reveal* (inner mat sampled from the photo)
  - *Black Core* (black bevel core on a white mat)
  - *Float Mount* (the photo floats above the board with a soft contact shadow and no window)
  - *Gallery Wall* (very wide mat, tiny caption, keyline)

### F2 — Editorial / Magazine
- **Idea**: the photo is laid out as a page. A grid, display type, captions and hairlines carry the hierarchy instead of shadows and boxes.
- **Why beautiful**: tension between a strong image and confident typography; asymmetric grids feel deliberate; hairlines are lighter than shadows.
- **For**: travel essays, street, portraiture, series covers, blog headers.
- **Structure**:
  - A page canvas, often a fixed aspect (see F4).
  - The photo placed on a column grid, which may be off-centre.
  - A masthead band at the top or bottom with a large title.
  - A caption block aligned to a column edge.
  - Hairline rules separating masthead, image and folio.
  - Optional type deliberately overlapping the photo edge.
- **Typography**: display serif or grotesk at 0.06–0.15 se with tight tracking; body text at 0.014–0.02 se; tracked uppercase labels (+60 to +120 / 1000 em); numerals as folios ("No. 07", "P. 12").
- **Material**: flat paper colours, newsprint off-white, or black.
- **Examples**:
  - *Masthead* (big title above, caption below)
  - *Plate* (photo plus numbered plate caption, book-plate style)
  - *Swiss Grid* (asymmetric 12-column grid with a rule system)
  - *Cover Line* (title type crossing into the photo)
  - *Contents* (multi-line caption block with a lens/settings "colophon")

### F3 — Overlay
- **Idea**: information lives on the photo instead of next to it: type, a translucent panel, a stamp, viewfinder marks.
- **Why beautiful**: keeps the full image and canvas aspect, feels native and immediate. It works when placement respects the image's quiet areas.
- **For**: social posts, cinematic frames, night and street scenes, phone shots.
- **Structure**: one or more overlay regions anchored to the **photo box** (9 anchors plus insets). Each holds:
  - a text block,
  - a translucent panel ("glass": fill with opacity, optional blur of the area behind it),
  - a corner stamp or badge (rounded box, outline and text),
  - a 7-segment date stamp,
  - or HUD/viewfinder marks (corner brackets, centre cross, frame lines).
- **Typography**: high-contrast sans or mono; a segment font for date stamps; automatic ink colour from the local background luminance.
- **Material**: none, or a panel with a blurred backdrop.
- **Examples**:
  - *Date Stamp* (orange 7-segment date, bottom right)
  - *Glass Caption* (translucent lower panel)
  - *Viewfinder* (corner brackets and a mono spec line)
  - *Cinema Subtitle* (letterbox bars plus centred subtitle-style caption)
  - *Corner Badge*

### F4 — Social Canvas
- **Idea**: the output has a **fixed aspect** (1:1, 4:5, 9:16, 3:4). The photo is fitted inside and the leftover space becomes the design area, respecting platform safe zones.
- **Why beautiful**: no cropping, a consistent grid in a profile, and room for intentional typography or colour.
- **For**: Instagram, Xiaohongshu (小红书) and WeChat Moments posts, carousels, stories.
- **Structure**: a canvas of fixed aspect at a chosen output width. The photo is fitted with *contain* or *cover* and anchored. Background is a solid colour, the blurred photo, or a palette colour. Content is placed inside a safe-area frame (for example Story insets of about 14% top, 35% bottom and 6% sides, per Meta's ad specs).
- **Typography**: depends on the sub-style; usually larger than the bar families because of phone viewing.
- **Material**: flat colour or the blurred photo.
- **Examples**:
  - *No-Crop 4:5*
  - *Story Card* (9:16 with safe-zone caption)
  - *Palette Card* (photo plus 4–6 swatches extracted from it, with hex codes)
  - *Carousel Cover* (title plus photo, safe for the 3:4 grid preview)
  - *Split Spread* (photo on one half, text on the other)

### F5 — Analog Film
- **Idea**: the photo is shown as a frame of film: black rebate, sprocket holes, edge print, frame numbers. Alternatively, it is shown as a scan of a negative carrier with a filed or irregular border.
- **Why beautiful**: authenticity and rhythm. The repeated sprockets and edge numerals create a strong graphic frame around a quiet image.
- **For**: film shooters, nostalgic digital work, series and contact-style presentations.
- **Structure**:
  - **135**: the frame is 36×24 units. The rebate band carries sprocket holes on both long sides (pitch about 4.75 units, holes about 2.8×1.98 units with rounded corners). Edge print text and frame numbers sit between the holes, and adjacent frame edges can be shown.
  - **120**: a 6×6, 6×7 or 6×4.5 frame, no sprockets, wide rebate, with frame numbers and edge text on the backing-paper side.
  - **Filed carrier**: a rough black border with an irregular inner edge (edge mask).
- **Typography**: edge print in a condensed sans or dot-matrix style; frame numbers with arrow marks ("12 ▸ 12A"). The text is generic or user-entered, never a manufacturer wordmark.
- **Material**: rebate in near-black or orange-brown (negative) with a slight translucency gradient; optional grain and dust textures.
- **Examples**: *135 Strip*, *120 Square*, *Filed Negative*, *Contact Frame* (a single frame on a contact-sheet paper look), *Half Frame*.

### F6 — Print Object
- **Idea**: the output looks like a physical photographic object: an instant card, a postcard, a deckled print or a cabinet card.
- **Why beautiful**: tactility and narrative. The object frame says "keepsake".
- **For**: casual, family, travel and gifts.
- **Structure**:
  - **Instant card**: equal thin top and sides and a tall bottom (about 3–4× the side). The card has its own aspect, and the photo is cropped or fitted into a square or rectangular window.
  - **Postcard**: photo plus a back-side layout (stamp box, address lines) as an optional second panel.
  - **Deckled print**: a white paper border with torn edges on a darker backdrop and a soft shadow.
- **Typography**: a handwritten-feel CJK/Latin font for instant captions; small serif for postcard lines.
- **Material**: paper texture, a slightly warm white, contact shadow.
- **Examples**: *Instant*, *Instant Wide*, *Postcard*, *Deckle Print*, *Cabinet Card* (dark board, embossed-looking title line).

### F7 — Fine-art Signature and Edition
- **Idea**: the print border carries the artist's marks: signature, edition fraction, title and year, following print-signing conventions.
- **Why beautiful**: restraint and provenance. The marks are small and precisely placed.
- **For**: prints for sale, portfolio proofs, exhibition previews.
- **Structure**: a signing border of 0.25, 1 or 2 inches at the declared print size, or an equivalent ratio. Edition fraction ("3/25", "AP 1/3") at lower left, title centred, signature at lower right on the border, just under the image edge. An optional blind-stamp (embossed chop) rendered as a subtle relief.
- **Typography**: pencil-like small serif or handwritten font for edition and title; signature as the user's PNG.
- **Material**: cotton rag paper texture.
- **Examples**: *Signed Proof*, *Edition Border*, *Museum Label* (separate label block with title, year, medium, edition).

### F8 — CJK Mounting
- **Idea**: Chinese and East Asian presentation: vertical inscriptions, a red seal (印章), and scroll mounting (装裱) proportions with a large top section (天头) and a smaller bottom section (地头).
- **Why beautiful**: a distinct cultural typography that no surveyed app does well. Vertical text and seals give strong, quiet accents.
- **For**: landscape, architecture, travel in China, calligraphy-adjacent work.
- **Structure**:
  - A vertical title column (竖排) beside or over the photo, on the right reading right to left.
  - A seal near the end of the inscription.
  - Optional 题跋 multi-column inscription.
  - **Hanging scroll**: a tall canvas with a large top section, a smaller bottom section and side borders. Optional 惊燕 strips: two thin vertical ribbons hanging from the top.
- **Typography**: CJK serif (Song/Ming) or a kai-style font (楷); vertical CJK with correct punctuation and rotated Latin runs; seal text inside a square, in negative (白文) or positive (朱文) relief.
- **Material**: silk or paper textures; mounting colours such as celadon, ivory or indigo.
- **Examples**: *Vertical Title*, *Seal Corner*, *Hanging Scroll* (立轴), *Handscroll Band* (横披), *Inscription* (题跋).

### F9 — Colour-derived
- **Idea**: the frame's colours come from the photo itself: a dominant colour mat, a tinted keyline, palette swatches, a gradient bloom.
- **Why beautiful**: harmony without manual colour picking; every photo gets a unique but coherent frame.
- **For**: any family. Usually applied as a modifier on F1, F2 or F4 rather than as its own geometry.
- **Structure**: colour tokens resolved from a palette extracted once per photo: dominant, muted, light, dark and accent colours, plus derived tints (for example "dominant at lightness 92%, chroma 0.02" for a mat).
- **Examples**: *Tonal Mat*, *Accent Reveal*, *Palette Card* (shared with F4).

> Not a family but a cross-cutting concern: **Technical/spec** information (camera, lens, settings, film stock, exposure compensation) can appear inside any family. It is content, not construction.

---

## 3. Engine model

### 3.1 Pipeline

```
Config (schema v4)
  └─ Resolve: fields → strings, palette → colours, assets → sizes and metrics
       └─ Layout (pure, deterministic, integer px): boxes, text runs, patterns, masks
            └─ Display list: ordered drawing ops (JSON-serialisable)
                 └─ Paint: PIL (output) | Canvas 2D (preview)
```

- **Resolve** is the only stage that reads EXIF, the palette and asset files. Its output is plain data.
- **Layout** is a pure function of resolved data. It is implemented twice (TS and Python, see §4) and frozen by fixtures.
- **Paint** is thin: each op type maps to one drawing routine per renderer. No layout decisions are made in paint.

Today's `compute_layout → ComputedElement[]` (text/logo/signature/divider) is already an early form of this. The plan generalises it.

### 3.2 Units

One `Length` type everywhere: `{ v: number, u: 'se' | 'le' | 'cw' | 'ch' | 'px' | 'in' }`.
- `se` / `le`: fraction of the **photo's** short or long edge (the default). Looks scale with the photo.
- `cw` / `ch`: fraction of the **canvas** width or height (needed for fixed-aspect canvases).
- `in`: physical inches. Valid only when the config declares `print: { width_in | dpi }`. Used for signing borders (0.25 / 1 / 2 in).
- `px`: legacy and absolute escapes. Today's `margins` (absolute 0–600 px) migrate to `se`.

Every length rounds to integer pixels **once**, in layout, using one rounding rule (round half to even), so both languages produce identical integers.

### 3.3 Canvas model

```
canvas:
  size:     { mode: 'grow' }                         # today: photo + margins
          | { mode: 'fixed', aspect: [4,5], width_px?: 2160 }
          | { mode: 'print', width_in: 16, height_in: 20, dpi: 300 }
  fit:      'contain' | 'cover'                      # photo inside the content box (fixed/print)
  anchor:   9-point anchor + offset Length           # where the photo sits in leftover space
  margins:  { top, right, bottom, left: Length }     # ratio by default; supports drop (weighted bottom)
  safe:     { top, right, bottom, left: Length } | preset ('ig-story', 'ig-feed', 'xhs-cover')
  background: Paint                                  # colour | gradient | blur(photo) | texture
```

- **grow** keeps today's behaviour, so all 8 existing styles migrate unchanged.
- **fixed** derives the content box from margins, then fits the photo inside it. Leftover space stays as background.
- **safe** does not move the photo. It defines a named box `safe` that regions can anchor to. Preset values are versioned data, because platform guidance changes.

### 3.4 Named boxes and anchoring

Layout exposes **named boxes** that any layer can anchor to:
`canvas`, `content` (canvas minus margins), `photo`, `mat[n].window`, `mat[n].outer`, `safe`, `band:<id>` (any band region), `margin.top|right|bottom|left` (the space between photo and canvas edge per side).

Every placed thing uses `{ box, anchor, offset, size }`. This one mechanism replaces today's special cases (footer at the bottom of the canvas, signature at an anchor on the photo). Examples:
- a caption "locked to the lower-margin register" anchors to `margin.bottom` at 38% height;
- a date stamp anchors to `photo` bottom-right with an inset;
- a seal anchors to the end of a vertical text block (the text block becomes a box too).

### 3.5 Layer stack

A config is an **ordered list of layers**, painted bottom to top. The `photo` layer is fixed by the canvas model, and every other layer is explicitly placed below or above it.

| Layer kind | What it is | Typical families |
|---|---|---|
| `mat` | A board with an outer rect and a window around a target box (photo or inner mat). Has fill, an optional bevel/core (see stroke) and an optional texture. Stacking mats gives double mat reveals. | F1, F6, F7, F8 |
| `band` | A strip attached to an edge of a box (canvas, content, photo, mat) on **any** side. Holds today's flow layout (tracks, slots) **or** a text block. Today's `footer-bar` and `side-bar` become bands. A **top band** is now just `side: top`. | F0, F2, F8 |
| `overlay` | A box placed relative to any named box, including **on top of the photo**. Holds a panel (fill, opacity, optional backdrop blur, radius) and children. | F3, F4 |
| `mark` | A single free-positioned item: text block, logo, signature, seal, badge. Today's `free` region (signature-only) becomes this, for all content types. | F3, F7, F8 |
| `decoration` | Pure geometry: keyline, rule, corner brackets, pattern strip (sprockets), edge mask. | F1, F2, F3, F5, F6 |

Z-order is the list order. Blend modes are limited to `normal` and `multiply` (multiply exists only so paper and grain textures darken correctly; see §6 performance).

### 3.6 Primitives (the display-list op set)

This is the complete proposed op set. Families are expressed as combinations of these.

| # | Op | Parameters | Notes |
|---|---|---|---|
| P1 | `rect` | box, fill Paint, opacity, corner radius | Mats, panels, bands, rebate, swatches |
| P2 | `stroke` | box, width, colour, position (inside / centre / outside), dash? | Keylines, bevel core line, badge outlines |
| P3 | `bevel` | window box, width, core colour, light angle | A stroke with a 2-tone linear shade (lit/shaded sides). Fixed formula so both renderers match. |
| P4 | `rule` | from/to points, width, colour, cap | Editorial hairlines, dividers (replaces today's auto divider) |
| P5 | `shadow` | box, offset, blur radius, colour, opacity | Generalises today's photo shadow; float mount; deckle print lift |
| P6 | `image` | asset id, box, fit, tint/invert, opacity, 9-slice insets? | Photo, logos, signature, seal PNG, overlay art |
| P7 | `text` | positioned glyph runs (font id, size, tracking, colour, opacity, direction) | All text. Layout already split it into runs and positions (see 3.7). |
| P8 | `pattern` | strip box, unit shape (rect/rounded rect/circle/path), pitch, phase, colour | Sprocket holes, perforations, dotted borders |
| P9 | `texture` | box, texture asset id, scale, offset, blend (normal/multiply), opacity | Paper, silk, grain, dust |
| P10 | `mask` | target layer, polygon or rounded rect | Deckled or torn edges and filed carriers. The polygon is generated in **layout** from a seeded noise function, so its geometry is exact in both languages. |
| P11 | `blur-backdrop` | box, sigma (in se) | Blurred-photo background (exists) and glass panels |
| P12 | `clip` | box or polygon, push/pop | Rounded photo corners (exists as photo_radius), panels |

`Paint` is a colour, a 2-stop linear gradient, or a colour token (see 3.9). Gradients are limited to 2 stops along an axis, because that is the only form both renderers draw identically enough.

### 3.7 Typography

**Font roles.** Styles refer to roles, not files. Each role maps to a Latin font plus a CJK fallback:

| Role | Latin | CJK | Use |
|---|---|---|---|
| `sans` | Inter | Noto Sans CJK SC | Default UI-like text; existing styles map here, with Noto Sans as the Latin font too, for byte compatibility |
| `serif-text` | EB Garamond | Noto Serif CJK SC | Captions, labels, editions |
| `serif-display` | Fraunces (static instances) or Instrument Serif | Noto Serif CJK SC Bold/Black | Mastheads, titles |
| `grotesk-display` | Space Grotesk | Noto Sans CJK SC Bold | Swiss/editorial headlines |
| `mono` | IBM Plex Mono | Noto Sans CJK SC | Spec lines, HUD, film edge print |
| `kai` | (LXGW WenKai has Latin) | LXGW WenKai | Instant captions, CJK inscriptions, handwritten feel |
| `segment` | DSEG7 Classic | — (digits only) | Date stamps |

All of these are SIL OFL 1.1, per their repositories: Inter, EB Garamond, Fraunces, Instrument Serif, Space Grotesk, IBM Plex, LXGW WenKai and DSEG. Noto CJK is OFL per its repository's license file, which was not re-read for this plan. **Reserved Font Names** apply (for example "Inter", "LXGW / 霞鹜"): we must not ship modified or subsetted builds under those names. Either ship unmodified files, or rename the subsets. This affects web subsetting (see below).

**Static instances only.** Variable-font axes are handled differently by Canvas 2D (which has no `font-variation-settings`) and Pillow (which has `set_variation_by_axes`). We ship pre-instanced static files such as Fraunces 72pt-Light and Fraunces 144pt-Black, each listed as its own font id.

**Text properties added to `StyleConfig`:**
- `font_role` and `weight` (selects a static file).
- `tracking` in 1/1000 em.
- `case`: `none | upper | lower`. No small caps: Pillow cannot synthesise them, and real small-caps glyphs need OpenType feature support the two renderers do not share.
- `opacity`.
- `line_height`.
- `align`: start / centre / end / justify-last-left.
- `max_lines` and overflow policy (shrink / ellipsis / clip).

**Shaping and fallback, done in layout, not paint.** The largest parity risk is text, so text is measured once, the same way, in both languages:
1. A build step reads each font file with fontTools and writes a **metrics pack**: per-glyph advance widths, cmap coverage, ascent/descent/cap height, and optional pair kerning for Latin. The pack is versioned with each font's SHA-256.
2. Both layout engines split text into **runs** by glyph coverage (Latin font first, then the CJK fallback), apply `case`, measure with the metrics pack (sum of advances + tracking + kerning), wrap, and output **positioned runs** (x, y, font id, size, string).
3. Painters draw each run at the given position with the given font and do no measuring. Canvas uses `fillText` per run with `letterSpacing` set from tracking; PIL draws per run (per glyph when tracking ≠ 0).
4. No complex shaping (ligatures or contextual alternates). This is acceptable for Latin and CJK display; Arabic and Indic scripts are a non-goal.

**Vertical CJK** extends today's `vertical-glyphs`:
- Glyphs are stacked using the vertical advance from the metrics pack.
- 、。，．： are positioned in the upper-right of the em box via a small substitution table.
- Brackets 「」（） are rotated 90°.
- Latin runs are rotated 90° clockwise.
- 1–2 digit runs use tate-chu-yoko (horizontal-in-vertical).
- Columns flow right to left.

**Font loading.**
- **Python**: fonts live in `assets/fonts/`, fetched and SHA-256-verified like today's Noto files, listed in a `fonts.manifest.json` with role, file, sha256, license and reserved names.
- **Web**: Latin fonts are served whole as WOFF2. CJK fonts are 16–25 MB each, so the preview loads them lazily. Two options:
  - (a) Serve the full OTF on first use of a CJK role.
  - (b) Server-side subsetting per request, which renames the font; that is allowed under OFL because the files are not distributed as "the font".
  - Decision D2.
- The layout never depends on whether a font has loaded, because measurement uses the metrics pack. A preview drawn before the font loads has correct geometry and swaps glyphs in when ready.

### 3.8 Fields

New field ids, each with a formatter implemented in both languages and covered by a shared fixture file (`field_format_cases.json`, analogous to `auto_logo_cases.json`):

| Field | Source | Notes |
|---|---|---|
| `title` | user text (per photo, or per album look with per-photo override) | |
| `caption` | user text, multi-line | |
| `edition` | `{ kind: 'number' \| 'AP' \| 'PP' \| 'HC', n, total }` → "3/25", "AP 1/3" | |
| `film_stock` | user text (per album / per roll); optional read from XMP or user comment if present | No brand logos, text only |
| `exposure_comp` | EXIF `ExposureCompensation` → "+0.7 EV", "−1⅓ EV" | Thirds shown as fractions |
| `location` | user text; optional coarse place from GPS via an **offline** dataset (city-level) | Never online geocoding; GPS stays opt-in |
| `frame_no` | user text or sequence ("12", "12A") | Film family |
| `datetime` | EXIF, with a **format pattern** | Tokens `YYYY YY MM M DD D HH mm`, `MMM` (EN month abbreviation), `年月日`, `'YY MM DD` (date stamp), with a locale |
| `focal_length` | gains a `mode: actual \| equiv35 \| both` | Today it is always the 35 mm equivalent |

### 3.9 Colour

- **Palette extraction runs once per photo in Python** (worker or API), never inside a renderer. The algorithm is k-means in OKLab on a fixed 96 px downsample with deterministic seeding, returning dominant, muted, light, dark and accent colours plus 6 swatches. The result is stored in resolved data and returned to the client. The browser does not compute palettes, because browser and Pillow resampling differ and would give different colours.
- **Colour tokens** in configs: `{ token: 'palette.dominant' | 'palette.swatch[2]' | 'ink.auto' | 'ink.secondary' }` with optional OKLCH adjustments `{ l: 0.92, c: 0.02 }` or `{ dl: -0.1 }`. This makes "mat sampled from the image, made pale and nearly neutral" expressible as data.
- **Ink**: today's luminance-based ink switch is generalised to *local* luminance. For overlays, the luminance of the photo region under the overlay box (computed in resolve, Python side) picks light or dark ink.
- Resolve outputs literal `#RRGGBB(AA)` values only, so layout and paint never see tokens.

### 3.10 Assets

- **Textures**: tileable, seamless PNG/JPEG at 1024–2048 px, listed in an asset manifest with SHA-256, licence and intended scale (in se). Only CC0 or self-made textures (decision D5).
- **Overlay art** (viewfinder brackets, stamp frames): generated from primitives, not images, wherever possible.
- **Seals**: the user's PNG, or a **generated seal**: square box (P1/P2), text block in the `kai` or a seal-style role, optional rough edge mask (P10).
- **Logos**: unchanged (existing auto-logo and inversion logic), but placed through the generic anchoring of `mark` and `band`.

### 3.11 Style definition and control surface

A catalog entry gains:
- `layers`: the construction.
- `knobs`: a short declared list of user-facing controls, each mapped to one or more config paths. Examples: "Mat width" maps to `margins.*` and the drop ratio; "Accent from photo" toggles a colour token; "Caption".
- `content`: which fields the style shows by default.

The ordinary UI renders **only the knobs** plus content toggles. Advanced editing can show the full layer tree. This keeps the main surface simple however capable the engine becomes, and it fits the existing album-look patch model, because knobs are still config paths.

---

## 4. TS + Python parity plan

### 4.1 What "the same pixels" can mean

Canvas 2D and Pillow rasterise antialiased edges, text and blurs differently, so exact pixel equality is not achievable. The contract is:

1. **Geometry is exact.** The display list (every op, every integer coordinate, every run string, every colour) is byte-identical between TS and Python for every fixture.
2. **Paint is close.** Renders of the same display list differ by at most a tolerance: per-pixel ΔE (OKLab) ≤ 3 on 99.5% of pixels and SSIM ≥ 0.995 for the whole image. Text and blur areas get a looser threshold (ΔE ≤ 8). Thresholds are tuned in M1, then frozen.

### 4.2 Schema

- **Schema v4** adds: `canvas.size/fit/anchor/safe`, `Length` everywhere, `layers[]` (replacing `regions[]`), the new style properties, the fields above, colour tokens and the print block.
- **Migration v3 → v4**: a pure function implemented in Python (API and worker) **and** TS (web editor load), with fixtures holding v3 inputs and expected v4 outputs. Today's 8 styles must migrate to v4 configs whose display lists reproduce today's layout exactly (this is the M1 regression gate).
- **Single schema source**: the Pydantic models become the source of truth, exported as JSON Schema in CI. TS types are **generated** from that schema (for example with json-schema-to-typescript), replacing the hand-maintained `types.ts` interfaces. The `docs/consistency-contract.md` rule "TS ↔ Python types change together" then becomes mechanical.
- **Design tokens** (size ratios and so on) move from duplicated constants (`designTokens.ts` and `layout_engine.py`) into one JSON file loaded by both.

### 4.3 Golden fixtures

Three fixture sets live in `packages/kari-core/tests/fixtures/` and are consumed by both languages:

| Set | Input | Expected | Check |
|---|---|---|---|
| `display_list_cases/*.json` | v4 config + photo size + resolved data (fields, palette, asset sizes) | full display list | exact equality in TS and Python |
| `migration_cases/*.json` | v3 config | v4 config | exact equality |
| `field_format_cases.json` | EXIF/user values + options | strings | exact equality |
| `render_cases/` | display list + a small test photo | reference PNG rendered by PIL | Canvas render (headless Chromium via Playwright, same fonts) compared within tolerance |

`verify_flow_layout_parity.py` grows into `verify_engine_parity.py` covering all sets. It should also call `npm.cmd` on Windows; today it fails there.

### 4.4 Anti-drift rules

1. **Op registry check**: both painters export the list of op types they implement. A test fails if the lists differ, or if any op type has no `display_list_cases` and `render_cases` fixture.
2. **Primitive PR checklist** (enforced in review and CI): new op = schema change + TS layout + Python layout + both painters + ≥1 display-list fixture + ≥1 render fixture + doc entry. No partial landings.
3. **Determinism utilities** shared by spec, with golden vectors: rounding, the seeded PRNG (xorshift32 on 32-bit ints), the noise used for deckle polygons, and OKLCH conversions. Each language has a test that reproduces the golden vectors.
4. **Paint stays dumb**: lint/review rule that painters never call measurement or layout helpers. Anything computed in a painter is a parity bug waiting to happen.
5. **Metrics pack pinned by font SHA**: if a font file changes, the metrics pack and every fixture using it must be regenerated in the same change.

### 4.5 Alternative: one layout implementation (decision D1)

Instead of two layout engines, Python could be the **only** layout engine. The browser would send the config and receive the display list from the API or worker, debounced, and only paint it.
- **Pros**: parity drift in layout disappears; every new primitive is implemented once (plus two thin painters).
- **Cons**: every slider move costs a round trip (about 20–60 ms locally, more on the public site); offline or instant preview is lost; server CPU load grows.
- A middle path is possible: TS layout stays for the existing bar family only, and new families are laid out server-side only.

The recommendation is to **keep dual layout with the metrics pack and display-list fixtures** (§4.3–4.4). Reasons: both apps need instant preview while dragging, and the display-list contract makes dual implementation tractable. Revisit if M2 shows the parity cost is high.

---

## 5. Phased roadmap

Dependencies: **M1 is required by everything.** After M1, M2–M6 can be reordered except where noted.

### M1 — Foundations (no new look; proves the architecture)
- Schema v4, `Length` units, ratio margins with drop weighting, named boxes and anchoring.
- Display list + generalised op registry (P1, P2, P4, P5, P6, P7, P11, P12, which cover today's features).
- Metrics pack and run-based text layout; v3→v4 migration in both languages.
- Fixture sets and the Playwright render-diff harness; codegen of TS types; shared token JSON.
- **Exit gate**: all 8 catalog styles migrated to v4 with **unchanged layout** (byte-identical geometry to today's fixtures) and render diffs within tolerance.

### M2 — Gallery (first visible milestone)
- `mat` layer (multiple mats), `bevel` op (P3), keylines, drop/weighted margins, float-mount shadow, print block (`in` units, DPI) with print sizes.
- Font roles `serif-text` and `sans` with tracking, case and opacity; fields `title`, `edition`.
- Styles: *Museum Mat*, *Double Reveal*, *Black Core*, *Float Mount*, *Signed Proof* (F1 + F7).
- **What it proves visually**: a 16×20 in, 300 DPI print preview of a double mat with a 1.5 mm reveal and a white bevel core, weighted bottom and a tracked small caption. Web preview and PIL output are shown side by side, with the diff heatmap under tolerance. This is the moment the product stops looking like a "camera watermark" app.

### M3 — Editorial and full typography
- `band` on any side (top bars), text blocks (multi-line, wrapping, max_lines), rules (P4) as authored layers, display fonts (`serif-display`, `grotesk-display`, `mono`), datetime format patterns, `caption`, `location` (user text).
- Requires M2's font roles.
- Styles: *Masthead*, *Plate*, *Swiss Grid*, *Contents*, *Museum Label*.

### M4 — Overlays
- `overlay` layer with panels (opacity, radius, backdrop blur), generic `mark` for text, logos and seals, local-luminance ink, `segment` font, corner-bracket decoration.
- Requires M3 text blocks.
- Styles: *Date Stamp*, *Glass Caption*, *Viewfinder*, *Cinema Subtitle*, *Corner Badge*, *Cover Line* (F2 type over the image).

### M5 — Social canvas and colour
- `canvas.size: fixed`, `fit`, `anchor`, safe-zone presets; palette extraction service and colour tokens; swatch content.
- Requires M1. Benefits from M4 for overlays in safe zones.
- Styles: *No-Crop 4:5*, *Story Card*, *Palette Card*, *Carousel Cover*, *Split Spread*, *Tonal Mat* and *Accent Reveal* (F9 applied to F1).

### M6 — Film and material surfaces
- `pattern` op (P8) and 135/120 rebate geometry presets, `frame_no` and `film_stock` fields, the `texture` op (P9) with the curated texture pack, `mask` (P10) with seeded deckle polygons, the `kai` role, generated seals, vertical CJK refinements (punctuation, rotated Latin, tate-chu-yoko).
- Styles: *135 Strip*, *120 Square*, *Filed Negative*, *Instant*, *Deckle Print*, *Postcard*, *Vertical Title*, *Seal Corner*, *Hanging Scroll*.
- Textures and masks are the heaviest paint ops; they come last so the performance budget (§6) is measured on a stable engine.

| Family | Unblocked at |
|---|---|
| F0 Information Bar | already shipped; migrated in M1 |
| F1 Passe-partout | M2 (texture variants in M6) |
| F7 Fine-art edition | M2 (blind stamp in M6) |
| F2 Editorial | M3 (cover line in M4) |
| F3 Overlay | M4 |
| F4 Social canvas | M5 |
| F9 Colour-derived | M5 |
| F5 Analog film | M6 |
| F6 Print object | M6 (instant can ship in M2 without texture) |
| F8 CJK mounting | M3 (vertical title), M6 (seal, scroll textures) |

---

## 6. Risks and non-goals

### Trademarks and imitation
- **Brand marks**: no manufacturer film edge wordmarks (for example "KODAK SAFETY FILM"), no film-stock logos, no camera-brand typefaces, no OEM watermark look-alikes (for example Xiaomi's Leica-branded styles). Edge print and film stock are **generic or user-entered text** in our own fonts. Camera logos remain the existing opt-in auto-logo with the existing caveat.
- **Names**: style names avoid trademarks ("Instant", not "Polaroid" or "Instax"; "135 Strip", not "Portra").
- **App imitation**: families are generic photographic and print conventions. We do not copy a specific app's template geometry or iconography.

### Performance
- Outputs reach 460 MP in immich-ki, so full-resolution blurs and textures are expensive.
- Blurs keep today's approach: compute on a work canvas of at most about 1200 px long edge and upscale.
- Textures are tiled at their native scale with multiply blending in chunks (Pillow `ImageChops` per tile row), never one full-size texture image.
- Masks are polygons filled once at full resolution, which is cheap.
- Budget: each style must render a 50 MP output in ≤ 4 s on the NAS CPU; the M6 exit gate measures this.
- Web preview renders at preview size only.

### Fonts and bundle size
- CJK serif and kai fonts add about 20–40 MB to the image and to first-use downloads.
- Mitigations: fonts load lazily by role; subsets are renamed (OFL Reserved Font Names); and the font set stays to the roles listed, not an open font picker.

### Parity cost
- Every primitive is implemented in four places: two layouts and two painters.
- Mitigations: the display-list contract, codegen, the op registry check, and decision D1's escape hatch.

### Control-surface complexity
- **Risk**: the engine's power leaks into the main UI.
- **Rule**: main UI = pick a style + content toggles + that style's declared knobs (maximum 5). The layer tree is visible only in advanced mode.
- Album looks keep working because knobs map to config paths.

### Migration risk
- v3 configs stored in immich-ki SQLite and album looks must migrate losslessly. The M1 exit gate (identical layout for all 8 styles) and migration fixtures cover this, and the migration is one-way only after a backup (the existing backup feature).

### Non-goals (explicitly not built)
- Free-form canvas editing, drag-anything WYSIWYG, or arbitrary layer creation in the main UI.
- Complex text shaping (Arabic, Indic, OpenType ligatures/small caps), arbitrary user font upload, and variable-font axes at render time.
- Online reverse geocoding, AI caption generation, and automatic subject-aware overlay placement.
- Photo colour grading, film emulation LUTs, light leaks and dust "filters" as image processing (textures are frame material, not photo edits).
- Multi-photo compositions (contact sheets of many photos, collages, carousels as one render). This is a separate engine; only single-frame "contact look" styles are in scope.
- Animated or video outputs and transparent PNG outputs (JPEG remains the output; outer shapes are painted on an opaque background).
- More Information Bar parameter variants presented as new styles.

---

## 7. Decisions needed from the user

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Where layout lives | (a) TS + Python, frozen by display-list fixtures; (b) Python only, browser paints a display list from the server; (c) hybrid: old bar family dual, new families server-only | (a), revisit after M2 |
| D2 | Font set and CJK delivery | Approve the role list (Inter, EB Garamond, Fraunces or Instrument Serif, Space Grotesk, IBM Plex Mono, Noto Serif CJK SC, LXGW WenKai, DSEG7); full lazy CJK files vs server-side renamed subsets | Approve the list; lazy full files first |
| D3 | Schema v4 migration | One-way migration of stored configs (after automatic backup) vs keeping v3 readers forever | One-way with backup |
| D4 | Palette extraction location | Server/worker only (web preview needs one API call per photo) vs also in browser | Server only |
| D5 | Texture sources | CC0 packs vs self-photographed paper/silk scans | Self-made scans (distinctive and licence-clean), CC0 as stopgap |
| D6 | Which app gets new families first | Web, immich-ki or both (the catalog already separates them by app) | immich-ki first for gallery/print (print workflow lives there), both for social |
| D7 | Physical print support | Add `print` block (inches, DPI, output DPI metadata, optional TIFF/PNG) vs stay screen-only | Add it; gallery and edition styles depend on real inch conventions |
| D8 | First milestone scope | M2 gallery as the first visible proof vs M5 social first (more reach, less distinctive) | M2 |
| D9 | CI cost | Add headless Chromium render-diff to CI (~1–2 min) | Yes; otherwise paint parity is unverified |

## 8. Implementation decision log

The user authorised end-to-end implementation on 2026-11-07, with the recommended options. Decisions taken while building, and why:

| When | Decision | Why |
|---|---|---|
| M1 | **D1 = (a)**: layout stays dual (TS + Python), frozen by fixtures | Instant preview in both apps; geometry parity proven by `compose_cases.json` |
| M1 | **Additive schema instead of a v4 migration.** `layers[]` and `canvas.margin_unit` are optional fields on schema v3. Dumps omit them when unset, so every stored config, album look and render key stays byte-identical. This supersedes D3 for now. | A one-way migration of every stored immich-ki config is risky and buys nothing until a field actually has to change shape. `regions[]` keeps working as the information-bar layer. |
| M1 | **Layer lengths are always short-edge ratios** (no `Length` unit union yet) | One unit covers every family designed so far. A `unit` field can be added later without breaking stored data. |
| M1 | **Geometric layers lower to axis-aligned integer `rect` ops only.** Keylines, rules, mat reveals and bevel cores are rect rings, and the bevel is lit/shaded faces as flat colours. | Canvas `fillRect` and PIL `rectangle` on integer boxes produce identical pixels, so these primitives get exact pixel parity, not just tolerance parity. |
| M1 | **Text layers become ordinary text elements** and reuse the existing fit-and-draw path. A metrics pack is deferred. | Same measurement behaviour as today's bar text. A metrics pack is only needed once wrapping and justified layout arrive. |
| M1 | Draw-op opacity uses region-local compositing in PIL | Keeps translucent ops cheap at 400+ MP |
| M2 | **D2**: added Noto Serif CJK SC (Regular, Bold) as the `serif-text` role. Fonts are pinned by SHA-256 in `scripts/fetch_fonts.sh`, the single source for CI and image builds. Latin display fonts are deferred until a family needs them. | Noto Serif covers Latin and CJK in one file and is OFL 1.1 (LICENSE re-read). Fewer files means fewer parity risks. |
| M2 | Serif faces register lazily in both apps (`fonts.ts`, immich-ki `@font-face`); the canvas redraws on `loadingdone` | About 25 MB each; never downloaded unless a style uses them |
| M2 | Tracking, case and opacity live on `StyleConfig`. Tracked text is laid out glyph by glyph (advances + tracking) identically in PIL and Canvas; untracked text keeps the native kerned path. Small caps are excluded. | Pillow and Canvas only agree on per-glyph advances once letter spacing applies |
| M2 | **D6**: the gallery family (`museum-mat`, `double-reveal`, `black-core`, `float-mount`, `signed-proof`) ships in immich-ki first | That is where the print/album workflow lives; the web editor's control model is bar-specific |
| M2 | Engine-built styles carry `style_id` and declare ≤5 **knobs** that rebuild the style from its parameters. The editor shows knobs instead of the bar controls. | Simple main UI, and album-look exceptions stay small config patches |
| M2 | `style_catalog.json` (exported from TS) feeds Python validation, render smoke tests and the TS/Python parity run for every catalog style. The contract test fails when it is stale. | One fixture freezes what the apps actually build |

## Sources and verification notes

- Font licences were read from each project's repository on 2026-11-07: LXGW WenKai, Inter, IBM Plex, Fraunces, DSEG, EB Garamond 12, Instrument Serif and Space Grotesk all state SIL OFL 1.1. Fraunces is variable (opsz, wght, SOFT, WONK axes); Inter is variable and also ships static files; LXGW WenKai is static, with variable weights not planned.
- **Not confirmed on a page actually read**: the Noto Serif CJK licence (the repository page did not show it; OFL 1.1 is expected from the license file) and font file sizes (the 16–25 MB CJK figure comes from the existing Noto Sans CJK files in `assets/fonts`).
- Instagram Story safe-zone percentages, instant-film proportions, signing-border conventions and the survey of existing apps are cited in `docs/style-library-research-2026-11.md`.
- Sprocket and frame dimensions for 135 film (36×24 mm frame, about 4.75 mm perforation pitch) and the mat-cutting conventions (bevel core, double-mat reveal, weighted bottom) are standard trade knowledge and were not re-sourced for this document. Confirm them against a primary reference before encoding rebate presets in M6.
