# AGENTS.md

Demo site for `jsr:@tksh/svg2ui8a`. Deno-first, no `package.json`, no build
step: the server imports the library straight from JSR, rasterizes SVG to raw
RGBA, and the browser draws the pixels onto a `<canvas>` (no PNG encoder / no
client Wasm on the render path).

## Commands

All tasks are defined in `deno.json`:

```sh
deno task dev      # deno run --allow-net --allow-read main.ts  -> http://localhost:8000
deno task start    # same as dev
deno task check    # deno check main.ts og_test.ts bbox_test.ts region_test.ts
deno task fmt      # deno fmt
deno task lint     # deno lint
deno task test     # deno test og_test.ts bbox_test.ts region_test.ts
```

Gotchas:

- `deno task test`/`check` list test files **explicitly**; new `*_test.ts` files
  are not auto-discovered. Add them to both tasks.
- The server needs `--allow-net` and `--allow-read`; it auto-serves on
  port 8000.

## Architecture

Single-process `Deno.serve` HTTP server, these source layers:

- `main.ts` — server, routing, request parsing, static file serving. All
  non-`GET /` routes are matched by exact `pathname` in the dispatcher at the
  bottom (main.ts:332).
- `og.ts` — pure, dependency-free helpers for the OGP card feature.
- `region.ts` — server-side region parsing/validation and `fit=bounds` math (1x1
  probe render, box union, `max(1, 1%)` padding); unit-tested in
  `region_test.ts`.
- `public/bbox.js` — pure bbox overlay helpers (region mapping, formatting,
  overflow margins, drawing). Imported by both `public/app.js` (browser) and
  `bbox_test.ts` (Deno tests), so keep it free of DOM access at module load.
- `public/` — static assets (`index.html`, `app.js`, `styles.css`, sample SVGs)
  served flat from disk.

The bundled `public/ghostscript_tiger.svg` is read once at startup into
`SVG_TEXT` (main.ts:23) and is the default SVG for every render API when no SVG
is supplied.

### HTTP API

Every render endpoint accepts `GET` and `POST`:

- `GET|POST /api/rgba` ->
  `{ width, height, naturalWidth, naturalHeight, alphaMode, region,
  pixelsBase64, absBoundingBox, absStrokeBoundingBox, absLayerBoundingBox }`
  (standard base64 pixels, `btoa` in `encodeBase64`, decoded client-side with
  `atob`; boxes are `RectF | null`; `region` is the window actually rasterized,
  defaulting to the natural canvas, see below).
- `GET|POST /api/usvg` -> `{ byteLength, usvg }` (svg2usvg bytes decoded back to
  XML).
- `GET|POST /api/png` / `GET|POST /api/webp` -> raw image bytes,
  `cache-control: public,
  max-age=86400` (intended to be usable directly as an
  `og:image` URL); same `region`/`fit` inputs as `/api/rgba`.
- `GET /api/source` -> the bundled tiger SVG (from memory, not from disk).
- `GET /og` -> server-rendered OGP card HTML (see below).

Request resolution rules (`resolveRenderInput`, main.ts:144):

- **POST JSON body values always win over query params**; query fills gaps;
  bundled sample is the default.
- GET `?svg=` is **base64url** (RFC 4648 §5, `decodeBase64Url`), so URLs need no
  percent-encoding; padding optional. Anything else is a 400.
- `width`/`height` must be integers in `1..4096` (`parseSizeParam`); the same
  4096 cap is mirrored in `public/app.js` (`scaledSize`) and in the HTML `max`
  attributes.
- `alphaMode` (POST body or `?alphaMode=`) must be `"straight"` or
  `"premultiplied"` when given; it maps straight onto
  `Svg2RgbaOptions.alphaMode` and is echoed back in the `/api/rgba` response so
  the UI shows what was applied.
- `region` (POST object `{x,y,width,height}`, else GET `rx/ry/rw/rh`) selects
  the rendered window in canvas coordinates and **wins over `fit=bounds`**; the
  values must be finite with positive width/height and are not clamped
  (negative/large windows are legal).
- `fit` (POST `fit: "bounds"`, else `?fit=bounds`) renders once at 1x1 to read
  the boxes (they are size-independent), fits their union (layer, then stroke,
  then fill) plus `max(1, 1%)` padding, and renders that region. Empty documents
  fall back to the natural canvas.
- POST bodies must be JSON objects; empty/non-JSON POSTs are treated as `{}`
  (fall through to query/defaults). SVG strings capped at `MAX_SVG_LENGTH` =
  1,000,000 chars.
- Input errors -> 400 `{ error }`; rendering failures -> 500 `{ error }`.

### Static serving (`serveStatic`, main.ts:41)

Intentionally flat and traversal-proof: it rejects any `rel` containing `/` or
`\`, so **nested files under `public/` will not be served**. Content type comes
from a small extension map (`CONTENT_TYPES`); unknown extensions fall back to
`application/octet-stream`. Non-GET requests that fall through the API routes
return 404.

### OGP cards (`/og`, `og.ts`)

Scrapers don't run JS, so meta tags are rendered server-side as a template
string.

- Only `rect` (`?shape=rect&fill=red&w=2&h=2`) and `circle`
  (`?shape=circle&fill=blue&r=50`) are supported. Text is deliberately excluded
  because svg2ui8a has no text support.
- Params are strictly validated: named colors from `NAMED_FILLS` or
  `#rgb`/`#rrggbb`; dimensions bounded by the 1200x630 canvas. Unknown/extra
  params are ignored.
- **Invalid or absent params must never error**: they fall back to
  `genericMeta()` and a generic `/api/png` image. Preserve this contract.
- `shapeMeta` derives the title/description from the validated `ShapeSpec` (the
  source of truth), never by parsing the generated SVG.
- `escapeAttr` is applied to any value interpolated into HTML attributes — keep
  it that way to avoid attribute-breakout injection.
- `og:image` uses an absolute URL: `publicBaseUrl` picks `http` for
  localhost/127.0.0.1 and `https` otherwise (Deno Deploy compatible).

### Bounding boxes and views (`/api/rgba` + `public/bbox.js`, `region.ts`)

Every successful render returns the three `usvg` root boxes as
`{ x, y, width, height } | null` objects: `absBoundingBox` (geometry),
`absStrokeBoundingBox` (geometry plus stroke), `absLayerBoundingBox` (layer,
filter-aware). The UI always shows all three as text (a `null` is rendered
literally) plus a second column with output-pixel coordinates mapped through the
response's `region` window.

- **The boxes are in canvas coordinates (unaffected by sizing), while the output
  shows the `region` window.** `toPixelRect(rect, region, width, height)` scales
  by `output / region` per axis and offsets by `-region.{x,y}`; with both output
  sizes requested the scale is non-uniform.
- **View modes.** The `View` select posts nothing (natural), `fit: "bounds"`, or
  a custom `region`. `region.ts` computes fit windows server-side (see the API
  section). Outside the natural view, `drawViewBoxOutline` draws a 1 px solid
  magenta (`#ff00ff`) outline of the document viewBox, and `#viewbox-legend`
  shows the matching swatch; magenta is unused by the boxes (geometry is
  `#ff4500`, not pure red) and stays visible on gray artwork.
- In fit/custom views, `#preview-note` marks that the native `<img>` preview
  still clips to the document viewBox while the canvas reflects the view.
- The overlay is a **separate, transparent, absolutely positioned canvas**
  (`.canvas-wrap` + `#bbox-overlay`), so the raster canvas keeps the library's
  pixels untouched; the `Bounding boxes` checkbox only hides the overlay.
- The overlay bitmap extends at least half the outline line width past the
  raster on every side, plus any box overflow beyond the frame, uncapped
  (`overlayLayout` + `boxOverflow` in `public/bbox.js`, applied as percentage
  left/top/width/height styles), so boundary and off-frame outlines stay
  visible. The raster output size and pixels never change. Rects are drawn
  shifted by that padding.
- Each table row has a per-box toggle that hides only that outline, via
  `bboxToggles` + `drawOverlay(data)` reusing the last render response
  (`lastBboxData`); text values are always shown for all three boxes.
- Outlines are drawn in their own color and dash pattern only, no halo or
  outline behind them, so nothing but the three box colors appears.
- Both canvases share intrinsic pixel dimensions, so their CSS scaling matches
  and rects stay aligned; the overlay never gets the `pixelated` class.
- `isClipped` flags boxes sticking out of the rendered view (common: stroke
  overhang), shown in the table's Note column as `extends beyond view`; canvas
  stroking clips naturally.
- `absLayerBoundingBox` typically equals `absStrokeBoundingBox` for the root (it
  only differs with root-level filters), so equal values are expected, not a
  bug.

## Conventions

- Code style is `deno fmt`: 2-space indent, double quotes, semicolons, trailing
  commas. Run `deno task fmt` before finishing.
- Deno-only APIs: `Deno.serve`, `Deno.readFile`, `Deno.readTextFile`,
  `Response.json`.
- `PhotonImage` is used with `using` (explicit resource management) in
  `handleEncoded`.
- Browser code (`public/app.js`) is a native ES module with top-level `await`,
  loaded via `<script type="module">`, importing `./bbox.js` relatively. It is
  not bundled or transpiled.
- Tests import `@std/assert` via the bare import-map specifier, not `jsr:`
  inline.
- Hex colors are normalized to lowercase in `og.ts` and uppercased only for
  display.

## Testing

- `og_test.ts` covers `og.ts` (parsing, SVG building, meta derivation,
  escaping); `bbox_test.ts` covers `public/bbox.js` (region mapping, formatting,
  clipping, overflow margins, and canvas drawing against a mock 2D context);
  `region_test.ts` covers `region.ts` (region parsing/validation, fit padding
  and box union).
- Standard `@std/assert` + `Deno.test`. New behavior should get a matching test
  case in the relevant file.
- Running `deno task test` is the required check after touching `og.ts`,
  `region.ts`, or `public/bbox.js`.

## Dependencies

Pinned via the `imports` map in `deno.json` (JSR specifiers, no npm):
`@tksh/svg2ui8a` (with `/svg2rgba` and `/svg2usvg` subpaths), `@denext/photon`,
`@std/encoding/base64url`, `@std/assert` (tests). The bbox fields require
svg2ui8a >= 0.4.0, `region` requires >= 0.5.0 (`naturalWidth`/`naturalHeight`
came in 0.3.6). Bumping a dependency requires editing both `deno.json` and
`deno.lock`, and `main.ts` imports subpaths explicitly, so adding a new svg2ui8a
subpath means adding an import-map entry too.
