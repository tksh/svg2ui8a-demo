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

- `main.ts` — `Deno.serve` static server with two JSON APIs:
  `GET|POST /api/render` uses `svg2rgba` (`jsr:@tksh/svg2ui8a/svg2rgba`),
  returns `{ width, height,
  alphaMode, pixelsBase64 }`; `GET|POST /api/usvg`
  uses `svg2usvg` (`jsr:@tksh/svg2ui8a/svg2usvg`), converts the SVG into a
  `Uint8Array` and decodes it back into the normalized usvg string, returns
  `{ byteLength, usvg }`. POST takes a JSON body `{ svg?, width?, height? }`
  (the page sends the edited textarea contents); GET takes query params
  `?svg=&width=&height=`, where `svg` is a base64url-encoded SVG string (decoded
  with `decodeBase64Url` from `jsr:@std/encoding`; URL-safe, so no
  percent-encoding needed, padding optional). Without `svg`, GET renders the
  bundled `ghostscript_tiger.svg`. POST body values take precedence over query
  params.
- `public/index.html` + `public/app.js` — sample dropdown (Ghostscript Tiger by
  default, Straightlines) plus an editable SVG textarea; Render posts its
  contents and shows the native SVG next to the library rendering (`<canvas>`),
  plus the usvg intermediate. Two toggles: `Auto size × devicePixelRatio` (on by
  default; requests the width/height inputs scaled by `devicePixelRatio`,
  clamped to the 4096px server limit) and `Pixelated` (off by default;
  nearest-neighbor display scaling for raw-pixel inspection).
- `public/ghostscript_tiger.svg` — Ghostscript Tiger sample (default).
- `public/straightlines.svg` — straight-lines sample (tksh/Straightlines
  ruleset).
