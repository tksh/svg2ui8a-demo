import { assert, assertEquals } from "@std/assert";
import {
  BOXES,
  boxLineWidth,
  boxOverflow,
  drawBoxOverlay,
  drawViewBoxOutline,
  formatRect,
  isClipped,
  overlayLayout,
  toPixelRect,
  VIEWBOX_COLOR,
} from "./public/bbox.js";

const RECT = { x: 1, y: 2, width: 3, height: 4 };
const NATURAL = { x: 0, y: 0, width: 10, height: 10 };

Deno.test("BOXES lists the three RgbaResult boxes in draw order", () => {
  assertEquals(BOXES.map((box: { key: string }) => box.key), [
    "absBoundingBox",
    "absStrokeBoundingBox",
    "absLayerBoundingBox",
  ]);
});

Deno.test("BOXES colors are distinct and avoid the outline magenta", () => {
  const colors = BOXES.map((box: { color: string }) => box.color);
  assertEquals(colors, ["#ff4500", "#00ff00", "#0000ff"]);
  assertEquals(new Set(colors).size, 3);
});

Deno.test("the viewBox outline is magenta, distinct from every box", () => {
  assertEquals(VIEWBOX_COLOR, "#ff00ff");
  assert(
    !BOXES.some((box: { color: string }) => box.color === VIEWBOX_COLOR),
    "no box may reuse the outline color",
  );
});

Deno.test("toPixelRect maps 1:1 when output matches the region size", () => {
  assertEquals(toPixelRect(RECT, NATURAL, 10, 10), RECT);
});

Deno.test("toPixelRect scales uniformly when region and output match", () => {
  assertEquals(toPixelRect(RECT, NATURAL, 20, 20), {
    x: 2,
    y: 4,
    width: 6,
    height: 8,
  });
});

Deno.test("toPixelRect scales each axis independently", () => {
  // Both width and height requested: independent scaling is possible.
  assertEquals(
    toPixelRect(RECT, { x: 0, y: 0, width: 100, height: 50 }, 200, 50),
    {
      x: 2,
      y: 2,
      width: 6,
      height: 4,
    },
  );
});

Deno.test("toPixelRect applies the region origin as an offset", () => {
  assertEquals(
    toPixelRect(RECT, { x: 4, y: 4, width: 2, height: 2 }, 4, 4),
    {
      x: -6,
      y: -4,
      width: 6,
      height: 8,
    },
  );
});

Deno.test("toPixelRect keeps null boxes and ignores degenerate regions", () => {
  assertEquals(toPixelRect(null, NATURAL, 20, 20), null);
  assertEquals(
    toPixelRect(RECT, { x: 0, y: 0, width: 0, height: 10 }, 20, 20),
    null,
  );
  assertEquals(
    toPixelRect(RECT, { x: 0, y: 0, width: 10, height: -1 }, 20, 20),
    null,
  );
  assertEquals(
    toPixelRect(RECT, { x: 0, y: 0, width: Number.NaN, height: 10 }, 20, 20),
    null,
  );
});

Deno.test("formatRect renders null and fixed-decimal coordinates", () => {
  assertEquals(formatRect(null), "null");
  assertEquals(
    formatRect({ x: 1, y: 2.5, width: 3, height: 4 }),
    "x 1.00, y 2.50, w 3.00, h 4.00",
  );
});

Deno.test("isClipped detects boxes outside the canvas, edges included", () => {
  assertEquals(isClipped(null, 10, 10), false);
  assertEquals(isClipped({ x: 1, y: 1, width: 8, height: 8 }, 10, 10), false);
  assertEquals(isClipped({ x: 0, y: 0, width: 10, height: 10 }, 10, 10), false);
  assert(isClipped({ x: -0.5, y: 0, width: 10, height: 10 }, 10, 10));
  assert(isClipped({ x: 0, y: 0, width: 10.5, height: 10 }, 10, 10));
  assert(isClipped({ x: 0, y: 9, width: 10, height: 2 }, 10, 10));
});

interface Op {
  method: string;
  args: number[];
  strokeStyle?: string;
  lineWidth?: number;
}

function recorder() {
  const ops: Op[] = [];
  const state = { strokeStyle: "", lineWidth: 0 };
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    save() {
      ops.push({ method: "save", args: [] });
    },
    restore() {
      ops.push({ method: "restore", args: [] });
    },
    setLineDash(dash: number[]) {
      ops.push({ method: "setLineDash", args: dash });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      ops.push({ method: "clearRect", args: [x, y, w, h] });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      ops.push({
        method: "strokeRect",
        args: [x, y, w, h],
        strokeStyle: state.strokeStyle,
        lineWidth: state.lineWidth,
      });
    },
  };
  return { ctx, ops };
}

Deno.test("drawBoxOverlay clears then strokes each box in its own color", () => {
  const { ctx, ops } = recorder();
  const boxes = [
    { ...BOXES[0], rect: { x: 0, y: 0, width: 10, height: 10 } },
    { ...BOXES[1], rect: null },
    { ...BOXES[2], rect: { x: 5, y: 5, width: 5, height: 5 } },
  ];
  drawBoxOverlay(ctx, 100, 50, boxes);

  assertEquals(ops[0], { method: "clearRect", args: [0, 0, 100, 50] });
  assertEquals(ops.map((op) => op.method), [
    "clearRect",
    "save",
    "setLineDash",
    "strokeRect",
    "setLineDash",
    "strokeRect",
    "restore",
  ]);

  const stroked = ops.filter((op) => op.method === "strokeRect");
  assertEquals(stroked.length, 2);
  assertEquals(stroked[0].strokeStyle, BOXES[0].color);
  assertEquals(stroked[0].args, [0, 0, 10, 10]);
  assertEquals(stroked[0].lineWidth, 2);
  assertEquals(stroked[1].strokeStyle, BOXES[2].color);
  assertEquals(stroked[1].args, [5, 5, 5, 5]);
  // No halo or other extra strokes: only the three box colors are ever used.
  assert(!ops.some((op) => op.strokeStyle?.startsWith("rgba(0, 0, 0")));
});

Deno.test("drawBoxOverlay scales the line width with the canvas", () => {
  const { ctx, ops } = recorder();
  drawBoxOverlay(ctx, 4096, 4096, [
    { rect: { x: 0, y: 0, width: 1, height: 1 }, color: "#fff", dash: [] },
  ]);
  const stroke = ops.find((op) =>
    op.method === "strokeRect" && op.strokeStyle === "#fff"
  );
  assertEquals(stroke?.lineWidth, 8);
});

Deno.test("boxLineWidth scales with the raster and never drops below 2", () => {
  assertEquals(boxLineWidth(100, 50), 2);
  assertEquals(boxLineWidth(512, 512), 2);
  assertEquals(boxLineWidth(4096, 4096), 8);
});

Deno.test("overlayLayout adds half a line width on every side", () => {
  const layout = overlayLayout(100, 50);
  assertEquals(layout.padding, { top: 1, right: 1, bottom: 1, left: 1 });
  assertEquals(layout.bitmapWidth, 102);
  assertEquals(layout.bitmapHeight, 52);
  // CSS box in percent of the raster box: -1%/-2% offsets, 102%/104% size.
  assertEquals(layout.css.left.toFixed(6), "-1.000000");
  assertEquals(layout.css.top.toFixed(6), "-2.000000");
  assertEquals(layout.css.width.toFixed(6), "102.000000");
  assertEquals(layout.css.height.toFixed(6), "104.000000");
});

Deno.test("overlayLayout uses big-raster line widths and integral bitmaps", () => {
  const layout = overlayLayout(1536, 1536); // lineWidth 3 -> half 1.5 -> ceil 2
  assertEquals(layout.padding, { top: 2, right: 2, bottom: 2, left: 2 });
  assertEquals(layout.bitmapWidth, 1540);
  assertEquals(layout.bitmapHeight, 1540);
  assert(Number.isInteger(layout.bitmapWidth));
  assertEquals(layout.css.width.toFixed(6), "100.260417");
});

Deno.test("overlayLayout grows uncapped with box overflow per side", () => {
  const layout = overlayLayout(100, 50, {
    top: 500,
    right: 0,
    bottom: 1.2,
    left: 8,
  });
  assertEquals(layout.padding, { top: 500, right: 1, bottom: 2, left: 8 });
  assertEquals(layout.bitmapWidth, 109);
  assertEquals(layout.bitmapHeight, 552);
});

Deno.test("drawBoxOverlay keeps a raster-sized box fully inside", () => {
  const { ctx, ops } = recorder();
  // A box that coincides exactly with the raster: without padding its outline
  // would be clipped in half on all four sides.
  const boxes = [{
    ...BOXES[0],
    rect: { x: 0, y: 0, width: 100, height: 50 },
  }];
  const layout = overlayLayout(100, 50);
  drawBoxOverlay(ctx, 100, 50, boxes, layout.padding);

  assertEquals(ops[0], { method: "clearRect", args: [0, 0, 102, 52] });
  const stroke = ops.find((op) => op.method === "strokeRect");
  assertEquals(stroke?.args, [1, 1, 100, 50]);
  assertEquals(stroke?.lineWidth, 2);
});

Deno.test("boxOverflow reports how far boxes extend beyond the frame", () => {
  assertEquals(boxOverflow([], 100, 50), {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  assertEquals(
    boxOverflow(
      [
        { x: 10, y: 5, width: 20, height: 20 },
        null,
        { x: -8, y: -2, width: 30, height: 60 },
      ],
      100,
      50,
    ),
    { top: 2, right: 0, bottom: 8, left: 8 },
  );
});

Deno.test("drawViewBoxOutline draws a 1 px solid magenta window", () => {
  const { ctx, ops } = recorder();
  drawViewBoxOutline(
    ctx,
    { x: 1, y: 2, width: 30, height: 40 },
    { top: 3, right: 4, bottom: 5, left: 6 },
  );
  assertEquals(ops.map((op) => op.method), [
    "save",
    "setLineDash",
    "strokeRect",
    "restore",
  ]);
  const stroke = ops.find((op) => op.method === "strokeRect");
  assertEquals(stroke?.strokeStyle, VIEWBOX_COLOR);
  assertEquals(stroke?.lineWidth, 1);
  assertEquals(stroke?.args, [7, 5, 30, 40]);
  assertEquals(ops.find((op) => op.method === "setLineDash")?.args, []);
});
