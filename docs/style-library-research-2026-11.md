# Style Library Research — 2026-11

Status: research only. No code was changed. Written 2026-11-06 against `main` @ `7a2ee32`.

Update (same day): the preset catalogs have since been unified into `apps/web/src/stylePresets.ts`; `presetDefinitions.ts` and the immich-ki builders in `defaults.ts` referenced below no longer exist, and the immich-ki `minimal` style id is now `minimal-line`.

Scope: (1) audit what Kari Imprint styles exist today and what the engine can express, (2) survey what frame/border styles people actually use, (3) recommend a prioritized set of new presets and the engine work that would unlock the rest.

---

## Part 1 — Current style inventory

### 1.1 Where styles live

| Layer | File | Role |
|---|---|---|
| Schema (TS) | `apps/web/src/types.ts` | `ImprintConfig` v3, `MainControlConfig`, `resolveConfig()`, `colorSchemes`, preset base templates |
| Schema (API) | `apps/api/src/api/schemas.py` | Strict Pydantic validation, the real limits on every field |
| Web presets | `apps/web/src/presetDefinitions.ts` | 3 product presets = template + full `MainControlConfig` |
| immich-ki presets | `apps/immich-ki/web/src/defaults.ts` | 5 style builders that emit a full `ImprintConfig` directly |
| Layout (TS / Py) | `apps/web/src/layout/layoutEngine.ts` / `packages/kari-core/src/kari_core/shared/layout/layout_engine.py` | Dual implementation, kept in parity by Golden Fixtures |
| Tokens | `apps/web/src/designTokens.ts` ↔ `layout_engine.py` constants | Font / logo / signature / border / footer-height ratios |
| Ink colors | `apps/web/src/colorScheme.ts` ↔ `layout_engine.py` `_INK_COLORS` | Auto light/dark ink from background luminance |
| Effects | `apps/web/src/canvasEffects.ts` ↔ `processor/effects.py` | Blur background, photo corner radius, drop shadow |
| Field values | `packages/kari-core/src/kari_core/shared/render_values.py` | EXIF → display string formatters |
| Logos | `assets/logos/*` + `apps/immich-ki/logo-manifest.json` | 23 manifest entries (Apple, Canon, Fujifilm, GoPro, Hasselblad, Huawei, iQOO, Kodak, Leica, Nikon, Nothing, Olympus ×2, OPPO, Panasonic, Pentax, Phase One, realme, Ricoh, Sony, Xiaomi, XMAGE, Zeiss); only `fujifilm.png` is tracked in git, the rest are supplied at build time |

There are **no presets in kari-core**: `packages/kari-core/config/presets/` contains only `.gitkeep`. All presets are client-side data that compile to the shared `ImprintConfig` and render through the shared Python engine. Every preset below is therefore "client-defined, engine-shared".

kari-core also still contains the **legacy semi-utils-style processor pipeline** (`processor/filters.py`: `watermark`, `watermark_with_timestamp`, `margin`, `margin_with_ratio`, `rounded_corner`, `shadow`, `signature`, `blur`, …) with Jinja-templated JSON fixtures (`tests/fixtures/static/{standard1,standard2,normal1,normal2,blur,nikon_blur,center_logo}.json`). These map to the legacy semi-utils templates. They are **core-only** and not reachable from the Flow-Layout API or either frontend (inferred from the API's `regions`-only payload detection; not exhaustively traced).

### 1.2 Shared defaults that every preset inherits

- Typography: `NotoSansCJKsc-Bold.otf`, `bold: true`, `line_height: 1.2`, `size_reference: region_height` (`types.ts` `defaultStyle`).
- Font size ratios of bar height: small 0.18 / medium 0.23 / large 0.25.
- Logo height ratios of bar height: 0.36 / 0.44 / 0.54. Signature ratios of short edge: 0.15 / 0.20 / 0.25.
- Footer height ratios of image short edge: small 0.06 / medium 0.09 / large 0.13.
- Border width ratios of short edge: 0.0075 / 0.0165 / 0.022.
- Ink: `#222222` text on light backgrounds; secondary track auto-dims to `#7A7A7A`. On dark (luminance < 0.18) or blur backgrounds: `#F5F5F5` / `#A3A3A3`. Only the default color `#222222` adapts; explicit colors are respected.
- Divider: a 1‰-short-edge vertical rule is drawn automatically between a start/end logo and text (`layout_engine.py` ~L678–L790). Not configurable.
- Flow defaults: `dual-track`, `space-between`, cross `center`, `photo-outward`, gaps 0.012 short edge, track ratios 0.6 / 0.4.

### 1.3 Web presets (`apps/web/src/presetDefinitions.ts`)

All three share `layout_structure: 'footer'`, `scheme: 'dark'` (= dark ink on `#FFFFFF`), `footer_height_level: 'medium'` (0.09 short edge), margins 0, and no signature unless uploaded. The user can switch any of them to side-left/side-right, dark background, single/dual track, etc. from the main controls.

| id / name | Geometry | Tracks & slot content | Logo | Border / effect | Notes |
|---|---|---|---|---|---|
| `default` / 聚焦 (Focus) | Bottom bar, 0.09 short edge | Dual. primary-start `make camera_model` (large); primary-end `focal shutter aperture iso` (medium); secondary-start `lens_model`; secondary-end `gps datetime` | Center, large, `span` | Uniform white border, small (0.0075) on top/left/right | Bold everywhere; secondary track grey. **Ships GPS on by default** (see Risks). |
| `minimal` / 简约 (Minimal) | Bottom bar, 0.09 | Single. Only primary-end: `focal aperture iso shutter`. Right-aligned by `space-between` with empty start | Off (no space reserved) | None | Lowest density. |
| `soft-card` / 圆润 (Rounded) | Bottom bar, 0.09 | Dual. primary-start `custom_text "AKARI PHOTO"`; primary-end `camera_model`; secondary-start `datetime`; secondary-end `focal aperture iso` | Right, medium | White border medium (0.0165); `photo_radius: 0.02` | Template is called `polaroidFooter` / 拍立得, but the bottom bar is the same 0.09 height as the others, so it does not have instant-film proportions. Hard-codes the owner's brand text. |

Ownership: preset data is web-only. The config it produces is shared (same schema), and the API renders it through kari-core. Golden parity covers the layout engine, not the presets themselves. `apps/web/scripts/verifyPresetContract.mts` covers preset immutability.

### 1.4 immich-ki presets (`apps/immich-ki/web/src/defaults.ts`)

These are built as full `ImprintConfig`s, not via `MainControlConfig`. The default margins are **60 px absolute** on the three non-frame sides (`DEFAULT_FRAME_MARGIN`), not scaled to resolution.

| id / label | Geometry | Slots | Logo | Colors / effect |
|---|---|---|---|---|
| `classic` / 经典 | Bottom bar `height: 0.15`; 60 px margins top/left/right | Dual. primary-start `camera_model lens_model` Bold medium; secondary-start `focal aperture shutter iso` Regular medium | End (right), medium, auto brand | `#FFFFFF` bg |
| `minimal` / 极简单行 | Bottom bar 0.10 | Single. primary-start `camera_model` Bold large; primary-end params Regular large `#6E6E6E` | Off | `#FFFFFF` |
| `dark` / 深色 | As classic | As classic, text `#F2F2F2` / `#9A9A9A` | As classic (auto-inverted when mono) | `#141414` bg |
| `blur` / 模糊背景 | As classic, margins `max(60, 6% short edge)` | As classic, text `#FFFFFF` / `#D9D9D9` | As classic | `effect: {background: blur, photo_radius: 0.015, shadow: true}` |
| `plain` / 纯留白 | No regions; 60 px on all four sides | — | — | `#FFFFFF` |

Background swatches: white `#FFFFFF`, off-white `#F4F1EA`, light grey `#E9E9E9`, dark grey `#1A1A1A`, black `#000000`. The frame can be moved to the left or right side.

immich-ki uses Regular for the second line, while the web presets use Bold everywhere. **The two apps' preset sets have drifted**: web has 3 presets, immich-ki has 5, and they use different names, heights, margins and weight hierarchy.

### 1.5 Supported by the engine but not shipped as a preset

| Capability | Where | Shipped? |
|---|---|---|
| Side bars (left/right) with rotated text (`rotate-cw/ccw`, `rotate-with-edge`) and CJK `vertical-glyphs` | `TextDirection`, `side-bar` region | Reachable through controls in both apps, but no preset defaults to a side bar, and **`vertical-glyphs` is unused anywhere** |
| Footer + side bar together, or both side bars at once | Region loop sets each margin independently | Not exposed by either control surface |
| Arbitrary footer height ratio (0–1) and side width | `height`, `width` | Only 3 levels are exposed in web |
| `track_order: outward-photo`, custom `track_ratios`, `main_alignment: start/center/end` (e.g. centered caption), `cross_alignment` | `FlowLayoutConfig` | All presets use the defaults |
| Logo `placement` start/center/end × `track` primary/secondary/span | `LogoContent` | Only `span` is used |
| Per-slot explicit color (accent colors), per-slot Regular/Bold | `StyleConfig` | Only immich-ki minimal (`#6E6E6E`) uses it |
| Asymmetric canvas margins (matte / gallery passe-partout) | `canvas.margins` | Only immich-ki (60 px); all web margins are 0 |
| Blur background + shadow | `canvas.effect` | Only immich-ki `blur`; the web has no blur preset |
| `artist` field, `make`, `custom_text` chips with separators | `FieldId` | `artist` is used by no preset |
| Signature PNG in a free region at any of 9 anchors with an offset | `free` region | Shipped only as an optional upload (bottom-right, −5% offset) |
| Dark background on the web (`scheme: 'light'`) | `colorSchemes` | A toggle, not a preset |

### 1.6 Hard limitations that block new styles

1. **Fonts**: the schema enum allows exactly two files, Noto Sans CJK SC Regular and Bold (`FontFamily`, API `font_family`). There is no serif, mono, condensed, script, italic, or LED/dot-matrix font. **No letter-spacing (tracking), no uppercase or small-caps transform, no opacity.** Editorial, film-label and date-stamp looks all depend on these.
2. **Region set is fixed**: `footer-bar` (always the bottom of the canvas), `side-bar` (left or right), and `free`. There is **no top bar** and no "caption above photo". Several `footer-bar` regions all write to `margins.bottom`, so effectively there is one footer.
3. **Free regions render signatures only.** `_compute_free` emits only `SignatureContent`, so free text or logos cannot be placed on or around the photo (blocks overlays, date stamps, corner badges, masthead titles).
4. **Backgrounds**: solid color or blurred photo only. There are **no gradients, textures, paper or image fills**, and no tinted panel behind the bar only (the bar uses the canvas background).
5. **No line or shape primitives**: no keyline/hairline stroke around the photo, no rules between tracks, no boxes, badges, stamps or sprocket holes. The only line is the automatic logo divider.
6. **Border is uniform**: one color and three widths, applied to every empty side. Unequal bottom-heavy mats are possible only through `margins`, and those are **absolute pixels capped at 0–600** in the API (≈10% of a 6000 px edge). They do not scale with resolution.
7. **Canvas = photo + margins**: there is **no target aspect ratio** (pad to 4:5, 1:1 or 9:16). This blocks "No Crop for Instagram" and story layouts.
8. **Effects** are a fixed set: blur sigma, darkening, shadow offset and opacity are constants, and the radius is capped at 0.08.
9. **Logo**: one asset slot per flow region. The aspect ratio is clamped to 0.3–6 (default 3.0 when unknown). Monochrome inversion is heuristic. There is no badge or outline treatment.
10. **Fields**: there is no film stock, exposure compensation, title, edition number, or human-readable location. GPS is a raw coordinate string. `datetime` is the raw EXIF string cut to 16 characters (`YYYY:MM:DD HH:MM`) with **no format options**. Focal length prefers the 35 mm equivalent with no toggle.
11. **Output is JPEG** (no transparency), so outer canvas corners and irregular edges must be painted onto an opaque background.
12. Text color control in web `resolveConfig` forces every slot to the scheme ink unless a slot override is set. Accent colors need overrides and are not part of the preset model.

---

## Part 2 — What people actually use (web research)

All dates are as shown on the pages. App Store "last updated" dates often show month and day without a year; those are marked "(year not shown)".

### Family 1 — Classic EXIF frames and matte frames

- **Commercial apps converge on the same few layouts.** Lenso Pro advertises "Overlay, Bottom Bar, White Border, or Smart Side layouts" with built-in Leica/Hasselblad/Sony/Canon/Nikon/Fujifilm logos and adjustable fonts and colors (App Store, v1.0.6, Aug 15, year not shown; 1.0.0 on 2025-12-17). LensMark has 40 templates in 5 categories: Classic / Minimalist / Film / Cinematic / Polaroid. Its border types are none / white / black / film / Polaroid, with adjustable width and independent toggles for 8 EXIF elements (v1.5, Oct 16, year not shown). EXIFrame (Bytefig) lists 24 frame styles, "Classic, Gallery, Polaroid, Film Strip, Passport, Editorial, Museum Card, Tech HUD", plus Fujifilm recipe frames, 9 typefaces and 9 aspect ratios (v1.4.3, "5d ago").
- **Instant/Polaroid proportions**: Polaroid 600/SX-70 image 78.7 × 78.7 mm in an 88.9 × 106.7 mm frame. Instax Mini image 62 × 46 / card 86 × 54 mm, Wide 99 × 62 / 108 × 86, Square 62 × 62 / 86 × 72 (Pixotter, 2026-04-07). The page's own pixel recipe (top/sides 60 px, bottom 180 px = 3× the sides) contradicts its stated frame height, so treat the bottom margin as roughly 3–4.5× the side margin.
- Black/white **matte** variants are universal: every app above offers a white and a black border.

### Family 2 — Minimal editorial

- Portfolio templates such as **Weiss** (Framer marketplace, no date) describe the target as "minimal, monochrome, and editorial" with structured grids, refined typography, quiet spacing and metadata-style details. This is the same visual vocabulary photographers want in frames: small type, lots of negative space, metadata treated as captions.
- OneLine advertises "classic narrow frames", "magazine posters" and "photo book cover styles" (App Store v4.2.2, Oct 22, year not shown). EXIFrame lists "Editorial" and "Museum Card" frames.
- Implication: editorial looks rely on **typography** (serif or grotesk, tracking, uppercase) more than on geometry. Our two-font limit is the main gap.

### Family 3 — Social and creator styles

- **Instagram Story**: 1080 × 1920 (9:16). Meta's Story ad specs give safe margins of about 14% top, 35% bottom and 6% sides (SuperProfile guide, updated 2026-11-03, citing Meta ad-spec pages). The guide says applying these to organic Stories is its own recommendation. SocialSizes confirms 1080 × 1920 / 9:16 but gives no pixel margins (no date, "2026" in title).
- **"No Crop" padding** to 1:1 or 4:5 is a headline feature: PixFrame ("No Crop for Instagram", 135/120 film borders, color palette borders, line frames, "Shot On" templates, 16:9 split side credit; v2.15, Oct 15, year not shown). OneLine added 1:1, 4:5 and 9:16 canvases in 4.2.1.
- **Translucent "glass" bars and story templates**: PhotoFramify lists border/side/top/bottom/transparent watermark styles, "Glass Watermark", Breakout Frame, Color Silhouette, Photo Calendar, and "story-style templates" (v4.9.0, Oct 29, year not shown). LensBorder-Pro (open source) lists Classic / Postcard / Minimal / Glassframe / Floating / Lagoon / Palette Card templates, with gradients, shadows and paper gradients.
- **Palette cards** (extracted dominant colors shown as swatches) appear in PixFrame ("Color Walk"), PhotoFramify ("photo palette") and LensBorder-Pro ("Palette Card").

### Family 4 — Camera brand and lens themed

- **The Chinese "徕卡水印" (Leica-style watermark) wave** set the template: a white bottom bar, model on the left, brand logo plus a vertical divider plus parameters on the right. Apps built for it include 徕卡水印大师 (white or black frame, auto logo, editable parameters, batch of 18, personal PNG overlay; sspai, 2023-08-19) and 相机印 (4 frame styles, draggable camera/lens/settings/date/coordinates/signature, film-stock picker, black frame with white-adjusted logos, custom font, saved profiles; sspai, 2023-07-23). These articles are from 2023 but describe the archetype still in use.
- **OEM camera apps**: Xiaomi 15 Ultra offers four watermark styles, 徕卡限定水印 / 徕卡水印 / 打卡水印 / 标准水印, with a black or white background (IT之家 via Tiger Brokers, 2025-03-12).
- **Open-source reference**: semi-utils (the project this repo descends from) ships `standard1` (classic EXIF + logo), `standard2` (+ rounded corners, shadow, margin), `nikon_blur` (highlights the red "Z"), `blur`, `normal1` (params bottom-right), `normal2` (folder name + time in orange), and `center_logo` (centered logo with text on all four sides) (GitHub README, no date).
- 边框水印-光影边框大师 lists brands such as 佳能/尼康/徕卡/哈苏/富士/索尼/阿莱/Lumix/蔡司/理光/Apple with auto logo and lossless export (App Store v1.1.9, Apr 27, year not shown; previous release 2025-10-09).

### Family 5 — Fine art and print

- **Signature and edition conventions**: sign on the verso in the upper-left or lower-right of the print area, not on the border. Include title, year taken, edition size, optional print year, copyright and signature (ASMP, 2009-05-20; old but still the reference convention). Editions are written as fractions such as `3/25` and are "usually" signed; open editions have no limit (Gallery F, no date, © 2026).
- **Deckled edges**: these imitate handmade paper. Printers tear after printing and leave about a 2-inch border; fibrous cotton papers such as Hahnemühle Photo Rag work best (FinerWorks, 2024-09-26, updated 2026-02-25). Digital "torn edge" generators exist, but this is a physical-print aesthetic.
- Museum or gallery label content (title, year, medium, edition) maps directly onto a caption block, but none of our fields carry it.

### Family 6 — Retro and analog

- **Dazz** (Vintage Camera – Dazz): date stamps, 20+ film scratches and dust, 40+ light leaks, 30+ "retro mask styles", Polaroid and Fuji filters (App Store, latest listed version 1.2.3 on 2024-12-28).
- **Film frames**: PixFrame advertises 135 and 120 film-style borders. LensMark and PhotoFramify have "Film" categories. EXIFrame has "Film Strip" frames and **manual EXIF entry for film cameras**.
- **Film metadata is real demand**: film shooters log camera settings, **film stock**, time and location per frame and write them into scans (Hedley Wright on the Frames app, 2026-02-06; Colin Devroe, 2026-02-09). 相机印 adds a film-stock picker next to the shooting parameters.

### Family 7 — Chinese photography community practice

- The "Leica watermark" bottom bar (white or black, logo + divider + parameters) is the dominant style. Phone OEMs ship it natively (Xiaomi above), so users expect brand logos to be detected automatically and black and white variants to be available.
- Indie Chinese iOS apps (徕卡水印大师, 相机印, 光影边框大师, OneLine, PixFrame, Lenso, LensMark, PhotoFramify — most with Chinese-named developers) compete on: number of logos, batch size, lossless export, black/white frame toggles, film-stock fields, signature PNG overlays, saved templates, and social aspect padding.
- sspai (少数派) is the main long-form community venue where these tools are reviewed and launched.

---

## Part 3 — Synthesis

### 3.1 Comparison table

| Style family | Visual signature | Required content | Engine support today | Effort | Priority |
|---|---|---|---|---|---|
| EXIF bottom bar (white/black) | Bar under photo, model left, logo + divider + params right | Model, lens, params, logo | **Full** | Preset only | Already shipped; add a black variant and a logo-left variant |
| Brand-center bar | Centered logo, text on both sides | Logo, model, params | **Full** (logo `center`) | Preset only | High |
| Single-line spec strip | One thin line, model bold + params grey | Model, params | **Full** | Preset only | High |
| Instant / instant-film | Even thin sides, very tall bottom, handwritten-feel caption | Short caption or date | **Partial**: border + large footer approximates it; no handwriting font; bottom ratio capped by the 0.13 level unless set raw | Preset + allow footer > 0.13 | High |
| Gallery matte / passe-partout | Wide equal margins, tiny centered caption | Optional caption | **Partial**: margins in absolute px (max 600) do not scale | Engine: ratio margins | High (after margin fix) |
| Side spine | Vertical bar on the long edge, rotated text | Model, params | **Full** (side-bar + rotation) | Preset only | Medium |
| CJK vertical title (竖排题签) | Vertical CJK glyphs in a side bar, seal-like signature | Title text, date, signature | **Full** (`vertical-glyphs`, signature) | Preset only | Medium-high (CN differentiation) |
| Floating blur card | Photo floats on its own blurred copy, rounded + shadow | Model, params | **Full** (`effect`) | Preset only (web lacks it) | High |
| Social "no-crop" 4:5 / 1:1 / 9:16 + safe zone | Fixed canvas aspect, photo centered, info inside safe area | Any | **None**: no target aspect | Engine: canvas aspect + safe zone | High |
| Editorial / Swiss caption | Serif or grotesk, tracking, uppercase, hairlines | Title, model, date | **Weak**: no fonts, tracking, case or rules | Engine: font set + text transforms + rules | High |
| Glass bar overlay | Translucent bar over the photo | Model, params | **None**: no overlay regions, no opacity | Engine: overlay region + fill opacity | Medium |
| Palette card | Dominant-color swatches beside the photo | Extracted colors | **None** | Engine: color extraction + shape primitives | Medium |
| Museum label / signature + edition | Caption block with title, year, edition, signature | Title, edition, signature | **Partial**: custom_text + signature + artist; no title or edition fields | Preset now; fields later | Medium |
| Film rebate / sprocket / 135 / 120 | Black rebate, sprocket holes, edge print, frame numbers | Film stock, frame no. | **None**: no shapes or textures | Engine: shape primitives or overlay assets | Medium |
| Date stamp (orange LED) | Orange 7-segment date on the photo corner | Date | **None**: no text in free regions, no LED font, fixed date format | Engine: free text + font + date format | Medium |
| Paper texture / deckled edge / letterpress | Textured paper, irregular edges, debossed type | — | **None** | Engine: texture fills + edge masks | Low |
| Contact sheet | Grid of many frames with edge markings | Multiple photos | **None** (single-image pipeline) | Large | Low |

### 3.2 Recommended new presets (implementable with today's Region / Slot / Content model)

Every item below uses only existing schema fields. "Closest" names the existing preset to fork from. Names are generic on purpose (see Risks).

1. **Spec Strip / 参数条**
   - Use: everyday sharing; the most-requested "one line" look.
   - Layout: thin bottom bar (`small`, 0.06), single track.
   - Slots: primary-start `camera_model` Bold large; primary-end `focal aperture shutter iso` Regular large in secondary grey; logo off.
   - Type and color: white background, `#222222` / `#7A7A7A`; black variant via scheme.
   - Closest: immich-ki `minimal`; web `minimal` (which lacks the model).

2. **Brand Center / 品牌居中**
   - Use: brand-forward shots, the generic counterpart of semi-utils `center_logo`.
   - Layout: medium bar, dual track, logo `center` large.
   - Slots: start tracks `camera_model` / `lens_model`; end tracks `focal aperture shutter iso` / `datetime`.
   - Type and color: Bold primary, Regular secondary; white or black.
   - Closest: web `default` 聚焦, without GPS.

3. **Night Bar / 夜幕**
   - Use: a black-frame variant that the community expects next to every white frame.
   - Layout: classic dual-track bar; `scheme: light` (`#1A1A1A`) or `#000000`; logo end with auto-inversion.
   - Slots: as classic.
   - Type and color: `#F5F5F5` / `#A3A3A3`.
   - Closest: immich-ki `dark` (port it to web).

4. **Floating Card / 悬浮**
   - Use: social posts and phone wallpapers.
   - Layout: `effect: blur + shadow`, `photo_radius 0.015–0.02`, bottom bar with transparent-looking text over the blur.
   - Slots: primary-start `camera_model` Bold; secondary-start params Regular; logo end.
   - Type and color: white / `#D9D9D9` ink, chosen automatically.
   - Closest: immich-ki `blur` (port it to web).

5. **Instant / 即显相纸**
   - Use: casual, nostalgic, social.
   - Layout: border `medium` on top/left/right + footer at an explicit `height` of about 0.20–0.25 (set the raw ratio in the preset rather than the 0.13 level); `photo_radius: 0`; off-white background `#F4F1EA`.
   - Slots: single track, `main_alignment: center`, primary-start `custom_text` (user caption) or `datetime`; logo off.
   - Type and color: Regular, medium, `#3A3A3A`.
   - Closest: web `soft-card` (fixes its proportions and drops the hard-coded brand text).

6. **Side Spine / 侧脊**
   - Use: portrait-orientation photos, where a bottom bar wastes height.
   - Layout: `side-right` bar, `rotate-with-edge`, dual track, logo `end` `follow-flow`.
   - Slots: start tracks `camera_model` / `lens_model`; end tracks params / `datetime`.
   - Type and color: white or black.
   - Closest: any preset with `layout_structure: side-right`.

7. **Vertical Title / 竖排题签**
   - Use: Chinese-language travel and landscape work; nobody in the survey offers it.
   - Layout: `side-left` bar, `text_direction: vertical-glyphs`, single track.
   - Slots: primary-start `custom_text` (title / place name in CJK), primary-end `datetime`; signature PNG (seal) at the `bottom-right` free anchor.
   - Type and color: off-white `#F4F1EA` with `#222222` ink, or ink-on-red seal via the signature asset.
   - Closest: none (new structure). Needs a CJK + Latin mixing check.

8. **Gallery Caption / 画廊**
   - Use: portfolio and print previews.
   - Layout: equal wide margins via `canvas.margins` (immich-ki style), a small bottom bar `small` with `main_alignment: center`, single track.
   - Slots: primary-start `artist · custom_text(title) · datetime`; logo off; signature optional.
   - Type and color: Regular small, `#4A4A4A` on white or `#E9E9E9`.
   - Closest: immich-ki `plain` + web `minimal`. **Caveat**: margins are absolute px until margins become ratio-based (§3.3), so the preset must compute margins from the photo size at apply time, as immich-ki `blur` already does.

9. **Signed Print / 签名版**
   - Use: limited-edition and print proofs.
   - Layout: white border `large`; medium bar, dual track.
   - Slots: primary-start `custom_text` (title); secondary-start `custom_text` (edition such as "3/25") + `datetime`; primary-end `artist`; signature asset bottom-right in the free region.
   - Type and color: Regular, dark ink.
   - Closest: web `soft-card`.

10. **Travel Log / 旅拍日志**
    - Use: trips, where place and time matter more than gear.
    - Layout: medium bar, dual track, `track_ratios` 0.55 / 0.45.
    - Slots: primary-start `custom_text` (place), secondary-start `datetime`; primary-end `camera_model`, secondary-end params; logo off.
    - Type and color: white or off-white.
    - Closest: web `default`. GPS stays opt-in (privacy).

11. **Logo-Left Classic / 品牌左置**
    - Use: the other common "Leica-style" arrangement.
    - Layout: dual track, logo `start` with the automatic divider; text on the right using `main_alignment: end`.
    - Slots: model / lens + params / date.
    - Type and color: white or black.
    - Closest: web `default`.

12. **Quiet Matte / 留白**
    - Use: "I just want breathing room".
    - Layout: no regions; equal margins; optional `photo_radius` and `shadow`.
    - Slots: none.
    - Type and color: background swatches.
    - Closest: immich-ki `plain` (port it to web).

Suggested order: 1, 3, 4, 2, 5, 6, 12 (ports and near-free wins), then 7, 10, 11, 9, 8.

A prerequisite worth doing first: **unify the web and immich-ki preset catalogs** into one shared data module. Today they diverge in names, heights, margins and font weights, so every new preset would otherwise be written twice.

### 3.3 Styles that need engine work first

| Unlocks | Engine work (each touches TS + Python + API schema + Golden Fixtures, per `docs/consistency-contract.md`) |
|---|---|
| Gallery matte, Instant at correct proportions, all matte presets | **Ratio-based margins** (`short_edge_ratio`) instead of absolute 0–600 px, plus a per-side border |
| Social no-crop, Story templates | **Target canvas aspect** (1:1, 4:5, 9:16) with photo fit and **safe-zone insets** (Meta ad spec: about 14% top, 35% bottom, 6% sides) |
| Editorial, Swiss, museum label, film labels | **Font library** (one serif, one grotesk, one mono, one condensed; license-checked) plus `letter_spacing`, `text_transform: uppercase`, and opacity in `StyleConfig` |
| Date stamp, corner badges, overlays, mastheads, glass bar | **Text and logo content in `free` regions**, plus an overlay bar with fill color and opacity; a 7-segment-style font for date stamps |
| Hairline editorial, keyline frames, rules between tracks | **Stroke primitives**: photo keyline (width, color, inset), optional track rule |
| Film rebate / sprocket / 135 / 120, palette card | **Shape or overlay assets** (vector sprockets, rectangles), or pre-rendered overlay PNGs with 9-slice scaling; color extraction for palettes |
| Paper texture, letterpress, deckled edges | **Texture fills** (tileable paper with ID-referenced assets) and **edge masks** |
| Film looks, museum labels, editions | **New fields**: `film_stock`, `title`, `edition`, `exposure_compensation`, human-readable location; **datetime format options** (`YYYY.MM.DD`, `'YY MM DD`, locale) |
| Contact sheet, carousel covers | Multi-image composition, which is outside the current single-image pipeline |

### 3.4 Risks

- **Trademarks and logos.** The bundled logos (Leica, Zeiss, Hasselblad, Kodak, Fujifilm, …) are trademarks. `apps/immich-ki/README.md` already notes this. Keep preset names generic: no "Leica style", "徕卡水印", "Polaroid", "Instax" or "Kodak" in preset names or UI copy. Never reproduce edge-print wordmarks such as "KODAK SAFETY FILM". Use "Instant" / "即显相纸" rather than "Polaroid" / "拍立得" in names; the current `polaroidFooter` template id is internal, but the 拍立得 label should be reviewed.
- **Copying specific apps.** Do not mirror the exact layouts of OEM styles (Xiaomi's 徕卡限定水印 etc.) or of a single indie app's signature template. Combine the generic archetypes (bar, matte, spine, card) with Kari's own token system. Do not port semi-utils' `nikon_blur` red-"Z" treatment, because it styles a brand mark.
- **Personal branding in public presets.** `soft-card` hard-codes `"AKARI PHOTO"`. It should default to empty or `artist`.
- **Privacy.** The default web preset `聚焦` shows `gps` by default, which publishes the shooting location on every export. Make GPS opt-in.
- **Readability.**
  - Font ratios are relative to bar height, so a `small` (0.06) bar with `small` text gives text about 1% of the short edge, which is unreadable on phones after social compression.
  - Grey secondary text on blur backgrounds can drop below contrast thresholds.
  - Vertical CJK mixed with Latin model names (e.g. "ILCE-7M4") needs rotation rules.
  - Story safe zones push information into the middle of the frame.
- **Layout hazards.** The automatic logo divider plus long lens names can overflow a single-track bar. Unknown logo aspect falls back to 3.0. Side bars on landscape images become very thin. Run `diagnose_layout` overlap checks on every new preset across the fixture aspect ratios (3:2, 4:3, 16:9, 1:1, 2:3).

---

## Sources

Read in full or in part during this research. Dates are as shown on the page.

- Lenso Pro — App Store — https://apps.apple.com/us/app/lenso-pro/id6756495350 — v1.0.6 "Aug 15" (year not shown); 1.0.0 on 2025-12-17
- LensMark — App Store — https://apps.apple.com/app/id6760441266 — v1.5 "Oct 16" (year not shown)
- OneLine: EXIF Frame & Watermark — App Store — https://apps.apple.com/us/app/-/id6476151887 — v4.2.2 "Oct 22" (year not shown)
- PixFrame — App Store — https://apps.apple.com/us/app/id6748721755 — v2.15 "Oct 15" (year not shown)
- EXIFrame — App Store — https://apps.apple.com/app/id6738852892 — v1.4.3 "5d ago" relative to the fetch on 2026-11-06
- PhotoFramify — App Store — https://apps.apple.com/us/app/-/id6755989422 — v4.9.0 "Oct 29" (year not shown)
- 边框水印-光影边框大师 — App Store — https://apps.apple.com/app/id6480434136 — v1.1.9 "Apr 27" (year not shown); prior 2025-10-09
- Vintage Camera – Dazz — App Store — https://apps.apple.com/us/app/-/id1447237320 — v1.2.3 on 2024-12-28
- sspai, 徕卡水印大师 article — https://sspai.com/post/82157 — 2023-08-19
- sspai, 相机印 article — https://sspai.com/post/81413 — 2023-07-23
- IT之家 via Tiger Brokers, Xiaomi 15 Ultra watermark styles — https://www.itiger.com/news/2518089623 — 2025-03-12
- semi-utils README — https://github.com/leslievan/semi-utils — no date
- LensBorder-Pro README — https://github.com/GreFir/LensBorder-Pro — no date (v0.1.0/0.1.1)
- Pixotter, Polaroid photo size — https://pixotter.pages.dev/blog/polaroid-photo-size/ — 2026-04-07
- SuperProfile, Instagram Story size and safe zone — https://superprofile.bio/guides/instagram-story-size.md — updated 2026-11-03
- SocialSizes, Instagram Stories size — https://socialsizes.io/instagram-stories-size/ — no date ("2026" in title)
- ASMP, Signing your prints — https://www.asmp.org/strictly-business-blog/signing-your-prints/ — 2009-05-20
- Gallery F, What is an editioned print — https://galleryf.co.za/collecting-guide/what-is-an-editioned-print-in-photography/ — no date (© 2026)
- FinerWorks, Deckled or torn edge — https://support.finerworks.com/misc-stuff/how-to-create-a-deckled-or-torn-edge-look-for-your-prints — 2024-09-26, updated 2026-02-25
- Framer, Weiss template — https://www.framer.com/marketplace/templates/weiss/ — no date
- Colin Devroe, Hedley Wright on the Frames app — https://cdevroe.com/?p=9154 — 2026-02-09
- Hedley Wright, Frames: EXIF with film scans — https://hedleywrightphotography.com/frames-using-exif-data-with-film-scans-in-lightroom — 2026-02-06

Attempted but not usable: https://archipelago-quest.squarespace.com/quest-public/p/quest-tools-07-p (404), https://petapixel.com/what-is-a-contact-sheet/ (403), https://www.ithome.com/0/849/442.htm (403), https://hertze.gumroad.com/l/poserframes (no body text rendered), https://www.digitalcameraworld.com/features/instant-camera-film-sizes-how-big-are-all-the-instax-and-polaroid-formats (no body text), https://www.on1.com/creative-library/canvas-and-paper-borders/ (paywalled, 2022-01-25), https://nanoimage-net.pages.dev/blog/add-white-border-instagram/ (served unrelated watermark-tool content).

## Unverified

These were seen only in search-result snippets or could not be confirmed from a page that was read:

- Quest Tools 07 "Filmic Borders" (sprocket holes, edge markings, dust, partial adjacent frames) and Poserframes (scanned-negative rebate borders). Their product pages failed to load.
- Kodak 120 edge markings and frame-number placement, and the "KODAK SAFETY FILM" edge text. From snippets only.
- Contact-sheet template conventions (36 frames, hand-numbered). From snippets only; PetaPixel returned 403.
- Xiaomi's specific layouts for each of its four named styles; Xiaomi device watermark counts (33 / 31) and seasonal or animated watermarks. IT之家 returned 403.
- Instagram's switch to a 4:5 profile-grid display in early 2025. From a snippet only.
- That Meta's ad safe zones apply to organic Stories. The SuperProfile guide itself says this is its own recommendation.
- Exact instant-film bottom-border ratio. The Pixotter numbers are internally inconsistent.
- Claims that Dazz is the "top-rated" retro app of 2025. From an SEO page, not verified.
- Feature lists for every App Store app are the developer's own marketing copy; none of the apps were installed or tested.
- In the repo: that the legacy `processor/filters.py` pipeline is unreachable from the current API was inferred from payload detection, not exhaustively traced.
