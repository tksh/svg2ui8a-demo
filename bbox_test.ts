import { assert, assertEquals } from "@std/assert";
import {
  BOXES,
  boxLineWidth,
  drawBoxOverlay,
  formatRect,
  isClipped,
  overlayLayout,
  toPixelRect,
} from "./public/bbox.js";

const RECT = { x: 1, y: 2, width: 3, height: 4 };

Deno.test("BOXES lists the three RgbaResult boxes in draw order", () => {
  assertEquals(BOXES.map((box: { key: string }) => box.key), [
    "absBoundingBox",
    "absStrokeBoundingBox",
    "absLayerBoundingBox",
  ]);
});

Deno.test("BOXES uses one fully saturated channel per color", () => {
  const colors = BOXES.map((box: { color: string }) => box.color);
  assertEquals(colors.length, 3);
  assertEquals(new Set(colors).size, 3);
  for (const color of colors) {
    assert(/^#(?:ff0000|00ff00|0000ff)$/.test(color), color);
  }
});

Deno.test("toPixelRect maps 1:1 when output matches the natural size", () => {
  assertEquals(toPixelRect(RECT, 10, 10, 10, 10), RECT);
});

Deno.test("toPixelRect scales uniformly for aspect-ratio sizing", () => {
  assertEquals(toPixelRect(RECT, 10, 10, 20, 20), {
    x: 2,
    y: 4,
    width: 6,
    height: 8,
  });
});

Deno.test("toPixelRect scales each axis independently", () => {
  // Both width and height requested: independent scaling is possible.
  assertEquals(toPixelRect(RECT, 100, 50, 200, 50), {
    x: 2,
    y: 2,
    width: 6,
    height: 4,
  });
});

Deno.test("toPixelRect keeps null boxes and ignores degenerate natural sizes", () => {
  assertEquals(toPixelRect(null, 10, 10, 20, 20), null);
  assertEquals(toPixelRect(RECT, 0, 10, 20, 20), null);
  assertEquals(toPixelRect(RECT, 10, -1, 20, 20), null);
  assertEquals(toPixelRect(RECT, Number.NaN, 10, 20, 20), null);
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
  assertEquals(layout.padding, 1); // lineWidth 2 at this raster size
  assertEquals(layout.bitmapWidth, 102);
  assertEquals(layout.bitmapHeight, 52);
  // CSS box in percent of the raster box: -1%/-2% offsets, 102%/104% size.
  assertEquals(layout.css.left.toFixed(6), "-1.000000");
  assertEquals(layout.css.top.toFixed(6), "-2.000000");
  assertEquals(layout.css.width.toFixed(6), "102.000000");
  assertEquals(layout.css.height.toFixed(6), "104.000000");
});

Deno.test("overlayLayout uses big-raster line widths and integral bitmaps", () => {
  const layout = overlayLayout(1536, 1536); // lineWidth 3 -> padding 1.5
  assertEquals(layout.padding, 1.5);
  assertEquals(layout.bitmapWidth, 1539);
  assertEquals(layout.bitmapHeight, 1539);
  assert(Number.isInteger(layout.bitmapWidth));
  assertEquals(layout.css.width.toFixed(6), "100.195313");
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
