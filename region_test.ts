import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  fitPadding,
  fitRegion,
  isValidRegion,
  parseFit,
  parseRegion,
  type RectF,
  type RenderBoxes,
} from "./region.ts";

function query(values: string): URLSearchParams {
  return new URLSearchParams(values);
}

Deno.test("parseRegion reads the POST body object and wins over the query", () => {
  assertEquals(
    parseRegion(
      { region: { x: 1, y: 2, width: 3, height: 4 } },
      query("rx=-1&ry=-2&rw=-3&rh=-4"),
    ),
    { x: 1, y: 2, width: 3, height: 4 },
  );
});

Deno.test("parseRegion reads the GET query quartet", () => {
  assertEquals(parseRegion({}, query("rx=-0.5&ry=0&rw=32&rh=31")), {
    x: -0.5,
    y: 0,
    width: 32,
    height: 31,
  });
});

Deno.test("parseRegion returns undefined when absent", () => {
  assertEquals(parseRegion({}, query("")), undefined);
  assertEquals(parseRegion({}, query("svg=abc")), undefined);
});

Deno.test("parseRegion rejects malformed input", () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ region: null }, ""],
    [{ region: [0, 0, 1, 1] }, ""],
    [{ region: { x: 0, y: 0, width: 1 } }, ""],
    [{ region: { x: 0, y: 0, width: 0, height: 1 } }, ""],
    [{ region: { x: Number.NaN, y: 0, width: 1, height: 1 } }, ""],
    [{}, "rx=1&ry=2&rw=3"],
    [{}, "rx=1&ry=2&rw=3&rh=0"],
    [{}, "rx=1&ry=2&rw=3&rh=abc"],
  ];
  for (const [body, values] of bad) {
    assertThrows(
      () => parseRegion(body, query(values)),
      Error,
      undefined,
      `${JSON.stringify(body)} ${values} must be rejected`,
    );
  }
});

Deno.test("parseFit accepts only bounds, body first", () => {
  assertEquals(parseFit({}, query("")), false);
  assertEquals(parseFit({ fit: "bounds" }, query("")), true);
  assertEquals(parseFit({}, query("fit=bounds")), true);
  assertEquals(parseFit({ fit: "bounds" }, query("fit=nope")), true);
  assertThrows(() => parseFit({}, query("fit=nope")));
  assertThrows(() => parseFit({ fit: true }, query("")));
});

Deno.test("isValidRegion enforces finite positive dimensions", () => {
  assert(isValidRegion({ x: -5, y: -5, width: 1, height: 1 }));
  assert(!isValidRegion({ x: 0, y: 0, width: 0, height: 1 }));
  assert(!isValidRegion({ x: 0, y: 0, width: 1, height: -1 }));
  assert(!isValidRegion({ x: Number.NaN, y: 0, width: 1, height: 1 }));
  assert(
    !isValidRegion({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }),
  );
});

Deno.test("fitPadding is max(1, 1% of the longer side)", () => {
  assertEquals(fitPadding({ x: 0, y: 0, width: 10, height: 10 }), 1);
  assertEquals(fitPadding({ x: 0, y: 0, width: 27.9, height: 31 }), 1);
  assertEquals(fitPadding({ x: 0, y: 0, width: 1000, height: 500 }), 10);
});

Deno.test("fitRegion prefers layer, then stroke, then fill, then pads", () => {
  const layer: RectF = { x: 0, y: 0, width: 200, height: 100 };
  const stroke: RectF = { x: 10, y: 10, width: 80, height: 80 };
  const fill: RectF = { x: 20, y: 20, width: 40, height: 40 };

  assertEquals(
    fitRegion(
      {
        absBoundingBox: fill,
        absStrokeBoundingBox: stroke,
        absLayerBoundingBox: layer,
      },
      300,
      300,
    ),
    { x: -2, y: -2, width: 204, height: 104 },
  );
  assertEquals(
    fitRegion(
      {
        absBoundingBox: fill,
        absStrokeBoundingBox: stroke,
        absLayerBoundingBox: null,
      },
      300,
      300,
    ),
    { x: 9, y: 9, width: 82, height: 82 },
  );
  assertEquals(
    fitRegion(
      {
        absBoundingBox: fill,
        absStrokeBoundingBox: null,
        absLayerBoundingBox: null,
      },
      300,
      300,
    ),
    { x: 19, y: 19, width: 42, height: 42 },
  );
});

Deno.test("fitRegion keeps the natural canvas for empty documents", () => {
  const zero: RectF = { x: 0, y: 0, width: 0, height: 0 };
  const placeholder: RectF = { x: 0, y: 0, width: 1, height: 1 };
  assertEquals(
    fitRegion(
      {
        absBoundingBox: zero,
        absStrokeBoundingBox: zero,
        absLayerBoundingBox: placeholder,
      },
      10,
      20,
    ),
    { x: 0, y: 0, width: 10, height: 20 },
  );
  assertEquals(
    fitRegion(
      {
        absBoundingBox: null,
        absStrokeBoundingBox: null,
        absLayerBoundingBox: null,
      },
      10,
      20,
    ),
    { x: 0, y: 0, width: 10, height: 20 },
  );
});

Deno.test("fitRegion keeps fractional overflow boxes fractional", () => {
  const boxes: RenderBoxes = {
    absBoundingBox: { x: 2, y: 0, width: 27, height: 31 },
    absStrokeBoundingBox: { x: -0.5, y: 0, width: 32, height: 31 },
    absLayerBoundingBox: { x: -0.5, y: 0, width: 32, height: 31 },
  };
  assertEquals(fitRegion(boxes, 31, 31), {
    x: -1.5,
    y: -1,
    width: 34,
    height: 33,
  });
});
