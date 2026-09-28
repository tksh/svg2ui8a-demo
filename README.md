# svg2ui8a-demo

Demo site for [`jsr:@tksh/svg2ui8a`](https://jsr.io/@tksh/svg2ui8a). Deno-first:
the server imports the library straight from JSR.io, rasterizes SVG samples to
raw RGBA, and the page draws the pixels onto a `<canvas>`.

## Run

```sh
deno task dev
# open http://localhost:8000
```

## How it works

- `main.ts` — `Deno.serve` static server with three APIs: `GET|POST /api/rgba`
  uses `svg2rgba` (`jsr:@tksh/svg2ui8a/svg2rgba`), returns
  `{ width, height, naturalWidth, naturalHeight, alphaMode, region, pixelsBase64,
  absBoundingBox, absStrokeBoundingBox, absLayerBoundingBox }`
  (the three boxes were added in svg2ui8a 0.4.0, `region` in 0.5.0; `region`
  echoes the window that was actually rasterized, defaulting to the natural
  canvas); `GET|POST /api/usvg` uses `svg2usvg` (`jsr:@tksh/svg2ui8a/svg2usvg`),
  converts the SVG into a `Uint8Array` and decodes it back into the normalized
  usvg string, returns `{ byteLength, usvg }`; `GET|POST /api/png` and
  `GET|POST /api/webp` render via `svg2rgba` then encode with `PhotonImage`
  (`jsr:@denext/photon`) and serve the bytes directly as `image/png` /
  `image/webp`, so the URL works as an `og:image`:
  `/api/png?svg=<base64url>&width=1200&height=630`. POST takes a JSON body
  `{ svg?, width?, height?, region?, fit? }` (the page sends the edited textarea
  contents); GET takes query params `?svg=&width=&height=&rx=&ry=&rw=&rh=&fit=`,
  where `svg` is a base64url-encoded SVG string (decoded with `decodeBase64Url`
  from `jsr:@std/encoding`; URL-safe, so no percent-encoding needed, padding
  optional). `region` selects the rendered window in canvas coordinates and wins
  over `fit=bounds`, which probes the boxes and pads their union by
  `max(1, 1%)`. Without `svg`, GET renders the bundled `ghostscript_tiger.svg`.
  POST body values take precedence over query params.
- `og.ts` + `GET /og` — dynamic OGP cards (scrapers don't run JS, so the meta
  tags are rendered server-side). Shape params `?shape=rect&fill=red&w=2&h=2` or
  `?shape=circle&fill=blue&r=50` build a centered shape on a 1200×630 SVG;
  `og:title`/`og:description` are derived from the validated params (e.g.
  `Red filled rect` / `size: width=2 height=2`), and `og:image` points at
  `/api/png` with the built SVG. Absent/invalid params fall back to a generic
  card, never an error.
- `public/index.html` + `public/app.js` — sample dropdown (Ghostscript Tiger by
  default, Straightlines, Overflow), a `View` select (`Natural canvas` /
  `Fit to bounds` / `Custom` with x/y/w/h fields), and an editable SVG textarea;
  Render posts its contents and shows the native SVG next to the library
  rendering (`<canvas>`), plus the usvg intermediate. Two toggles:
  `Auto size ×
  devicePixelRatio` (on by default; requests the width/height
  inputs scaled by `devicePixelRatio`, clamped to the 4096px server limit) and
  `Pixelated` (off by default; nearest-neighbor display scaling for raw-pixel
  inspection). In fit/custom views a note marks that the native `<img>` preview
  still clips to the document viewBox.
- Bounding boxes — a table always lists all three `RgbaResult` boxes (`null`
  included) in canvas coordinates and mapped output pixels (mapped through the
  response `region`); color- and dash-coded rects are drawn on a separate
  transparent canvas stacked over the raster one, so the library output stays
  untouched. The overlay bitmap grows by half an outline line width per side
  plus any box overflow beyond the frame (no cap), so boundary and off-frame
  outlines stay visible while the raster keeps its exact output pixels. The
  `Bounding boxes` checkbox hides the overlay, and each table row has a checkbox
  that hides just that box's outline. Outside the natural view, a 1 px solid
  magenta `viewBox` outline shows the document window. `public/bbox.js` holds
  the pure mapping/formatting/drawing helpers, unit-tested in `bbox_test.ts`;
  `region.ts` holds the server-side region parsing/fit math, unit-tested in
  `region_test.ts`. Straightlines is the clearest sample: its strokes extend
  past the geometry box, so `absBoundingBox` and `absStrokeBoundingBox` differ
  visibly; `overflow.svg` is the fit-bounds showcase.
- `public/ghostscript_tiger.svg` — Ghostscript Tiger sample (default).
- `public/straightlines.svg` — straight-lines sample (tksh/Straightlines
  ruleset).
- `public/overflow.svg` — deliberately overflowing sample for the region views.
