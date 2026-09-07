# svg2ui8a-demo

Demo site for [`jsr:@tksh/svg2ui8a`](https://jsr.io/@tksh/svg2ui8a). Deno-first:
the server imports the library straight from JSR.io, rasterizes
`public/artwork.svg` to raw RGBA, and the page draws the pixels onto a
`<canvas>`.

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
  (the page sends the edited textarea contents); GET uses query params and the
  bundled `artwork.svg`.
- `public/index.html` + `public/app.js` — editable SVG textarea; Render posts
  its contents and shows the native SVG (`<img src="/artwork.svg">`) next to the
  library rendering (`<canvas>`), plus the usvg intermediate. Two toggles:
  `Auto size × devicePixelRatio` (on by default; requests the width/height
  inputs scaled by `devicePixelRatio`, clamped to the 4096px server limit) and
  `Pixelated` (off by default; nearest-neighbor display scaling for raw-pixel
  inspection).
- `public/artwork.svg` — the sample artwork (tksh/Straightlines ruleset).
