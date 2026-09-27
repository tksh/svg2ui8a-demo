import { assert, assertEquals } from "@std/assert";
import {
  buildShapeSvg,
  escapeAttr,
  genericMeta,
  OGP_HEIGHT,
  OGP_WIDTH,
  parseShapeParams,
  shapeMeta,
} from "./og.ts";

function params(query: string): URLSearchParams {
  return new URL(`http://localhost/og?${query}`).searchParams;
}

Deno.test("parseShapeParams accepts a red rect", () => {
  assertEquals(parseShapeParams(params("shape=rect&fill=red&w=2&h=2")), {
    shape: "rect",
    fill: "red",
    w: 2,
    h: 2,
  });
});

Deno.test("parseShapeParams accepts a blue circle", () => {
  assertEquals(parseShapeParams(params("shape=circle&fill=blue&r=50")), {
    shape: "circle",
    fill: "blue",
    r: 50,
  });
});

Deno.test("parseShapeParams normalizes fill case and hex", () => {
  assertEquals(
    parseShapeParams(params("shape=rect&fill=Red&w=1&h=1"))?.fill,
    "red",
  );
  assertEquals(
    parseShapeParams(params("shape=rect&fill=%23FF0000&w=1&h=1"))?.fill,
    "#ff0000",
  );
  assertEquals(
    parseShapeParams(params("shape=rect&fill=%230f0&w=1&h=1"))?.fill,
    "#0f0",
  );
});

Deno.test("parseShapeParams rejects invalid input", () => {
  const bad = [
    "",
    "shape=rect&fill=red", // missing dims
    "shape=rect&w=2&h=2", // missing fill
    "shape=rect&fill=red&w=0&h=2", // zero
    "shape=rect&fill=red&w=2.5&h=2", // non-integer
    "shape=rect&fill=red&w=99999&h=2", // out of range
    "shape=circle&fill=blue&r=99999", // radius too big
    "shape=circle&fill=notacolor&r=5", // unknown color
    "shape=circle&fill=red%3B&r=5", // injection-ish
    "shape=text&fill=red&label=hi", // text unsupported
    "shape=rect&fill=red&w=2&h=2&extra=1", // extra params are fine
  ];
  for (const q of bad.slice(0, -1)) {
    assertEquals(parseShapeParams(params(q)), null, q);
  }
  // Extra unknown params are ignored, the shape itself stays valid.
  assert(parseShapeParams(params(bad[bad.length - 1])) !== null);
});

Deno.test("buildShapeSvg centers a rect on the OGP canvas", () => {
  assertEquals(
    buildShapeSvg({ shape: "rect", fill: "red", w: 2, h: 2 }),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OGP_WIDTH}" height="${OGP_HEIGHT}" viewBox="0 0 ${OGP_WIDTH} ${OGP_HEIGHT}"><rect x="599" y="314" width="2" height="2" fill="red"/></svg>`,
  );
});

Deno.test("buildShapeSvg centers a circle on the OGP canvas", () => {
  assertEquals(
    buildShapeSvg({ shape: "circle", fill: "blue", r: 50 }),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OGP_WIDTH}" height="${OGP_HEIGHT}" viewBox="0 0 ${OGP_WIDTH} ${OGP_HEIGHT}"><circle cx="600" cy="315" r="50" fill="blue"/></svg>`,
  );
});

Deno.test("shapeMeta describes a red rect", () => {
  assertEquals(shapeMeta({ shape: "rect", fill: "red", w: 2, h: 2 }), {
    title: "Red filled rect",
    description: "size: width=2 height=2",
  });
});

Deno.test("shapeMeta describes a blue circle and uppercases hex", () => {
  assertEquals(shapeMeta({ shape: "circle", fill: "blue", r: 50 }), {
    title: "Blue filled circle",
    description: "size: radius=50",
  });
  assertEquals(
    shapeMeta({ shape: "rect", fill: "#ff0000", w: 1, h: 1 }).title,
    "#FF0000 filled rect",
  );
});

Deno.test("genericMeta falls back to a static card", () => {
  assertEquals(genericMeta(), {
    title: "svg2ui8a demo image",
    description: "Rendered with jsr:@tksh/svg2ui8a",
  });
});

Deno.test("escapeAttr neutralizes attribute breakouts", () => {
  assertEquals(
    escapeAttr(`"><script>alert(1)</script>&`),
    `&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;`,
  );
});
