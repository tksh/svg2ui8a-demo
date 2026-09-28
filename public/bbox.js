// Pure helpers for the bounding-box overlay in the demo UI.
//
// svg2ui8a exposes three usvg boxes on every RgbaResult (`absBoundingBox`,
// `absStrokeBoundingBox`, `absLayerBoundingBox`) in the SVG's canvas
// coordinates. Since 0.5.0 the server also reports the `region` window that
// was rasterized (defaulting to the natural canvas), so output mapping is
// "region -> output": a per-axis scale that is non-uniform when both output
// sizes are requested.

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} RectF
 */

// One entry per RgbaResult box, in drawing order. Vivid, mutually distinct
// colors; the dash patterns keep the outlines distinguishable without relying
// on color alone.
export const BOXES = [
  {
    key: "absBoundingBox",
    label: "absBoundingBox",
    color: "#ff4500",
    dash: [],
  },
  {
    key: "absStrokeBoundingBox",
    label: "absStrokeBoundingBox",
    color: "#00ff00",
    dash: [12, 6],
  },
  {
    key: "absLayerBoundingBox",
    label: "absLayerBoundingBox",
    color: "#0000ff",
    dash: [3, 6],
  },
];

// The document viewBox outline: magenta, which no box uses and which stands
// out on gray-heavy artwork like the Straightlines sample (yellow did not).
// The geometry box moved from red to #ff4500 so it stays distinct from this.
export const VIEWBOX_COLOR = "#ff00ff";

/**
 * Maps a box from canvas coordinates to output pixels through the rendered
 * `region` window. `null` boxes and degenerate regions map to `null`.
 * @param {RectF | null} rect
 * @param {RectF} region window rendered into the output
 * @param {number} width output width in pixels
 * @param {number} height output height in pixels
 * @returns {RectF | null}
 */
export function toPixelRect(rect, region, width, height) {
  if (rect === null) return null;
  if (!(region.width > 0) || !(region.height > 0)) return null;
  const scaleX = width / region.width;
  const scaleY = height / region.height;
  return {
    x: (rect.x - region.x) * scaleX,
    y: (rect.y - region.y) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

/**
 * Formats a box for the text panel; `null` (unmeasured) is shown as-is.
 * @param {RectF | null} rect
 * @returns {string}
 */
export function formatRect(rect) {
  if (rect === null) return "null";
  const f = (n) => n.toFixed(2);
  return `x ${f(rect.x)}, y ${f(rect.y)}, w ${f(rect.width)}, h ${
    f(rect.height)
  }`;
}

/**
 * True when the box sticks out of the rendered view, i.e. the output frame
 * (which equals the region window) cannot show it fully.
 * @param {RectF | null} rect
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
export function isClipped(rect, width, height) {
  if (rect === null) return false;
  const eps = 1e-6;
  return rect.x < -eps || rect.y < -eps ||
    rect.x + rect.width > width + eps || rect.y + rect.height > height + eps;
}

/**
 * Output-pixel line width of the box outlines (scales with the raster size).
 * @param {number} width raster width in pixels
 * @param {number} height raster height in pixels
 * @returns {number}
 */
export function boxLineWidth(width, height) {
  return Math.max(2, Math.round(Math.max(width, height) / 512));
}

/**
 * How far the mapped boxes extend beyond the output frame, per side, in
 * output pixels (never negative). The overlay margin uses this so outlines
 * that fall outside the frame stay visible.
 * @param {(RectF | null)[]} rects mapped output-pixel boxes
 * @param {number} width output width in pixels
 * @param {number} height output height in pixels
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function boxOverflow(rects, width, height) {
  const overflow = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const rect of rects) {
    if (rect === null) continue;
    overflow.left = Math.max(overflow.left, -rect.x);
    overflow.top = Math.max(overflow.top, -rect.y);
    overflow.right = Math.max(overflow.right, rect.x + rect.width - width);
    overflow.bottom = Math.max(overflow.bottom, rect.y + rect.height - height);
  }
  return {
    top: Math.max(0, overflow.top),
    right: Math.max(0, overflow.right),
    bottom: Math.max(0, overflow.bottom),
    left: Math.max(0, overflow.left),
  };
}

/**
 * Overlay geometry for a `width` x `height` raster. Every side gets at least
 * half the outline line width, so an outline lying exactly on the raster
 * boundary is drawn at full width; any box overflow beyond the frame is added
 * on top of that, uncapped (abnormal content is meant to be noticeable).
 * Pads are rounded up because canvas bitmaps are integral, and the CSS box is
 * in percent of the raster box so the two canvases stay aligned at any
 * display scale.
 * @param {number} width raster width in pixels
 * @param {number} height raster height in pixels
 * @param {{ top: number, right: number, bottom: number, left: number }} overflow
 * @returns {{
 *   padding: { top: number, right: number, bottom: number, left: number },
 *   bitmapWidth: number,
 *   bitmapHeight: number,
 *   css: { left: number, top: number, width: number, height: number },
 * }}
 */
export function overlayLayout(
  width,
  height,
  overflow = { top: 0, right: 0, bottom: 0, left: 0 },
) {
  const half = boxLineWidth(width, height) / 2;
  const padding = {
    top: Math.ceil(Math.max(half, overflow.top)),
    right: Math.ceil(Math.max(half, overflow.right)),
    bottom: Math.ceil(Math.max(half, overflow.bottom)),
    left: Math.ceil(Math.max(half, overflow.left)),
  };
  const bitmapWidth = width + padding.left + padding.right;
  const bitmapHeight = height + padding.top + padding.bottom;
  return {
    padding,
    bitmapWidth,
    bitmapHeight,
    css: {
      left: (-padding.left / width) * 100,
      top: (-padding.top / height) * 100,
      width: (bitmapWidth / width) * 100,
      height: (bitmapHeight / height) * 100,
    },
  };
}

/**
 * Draws the box overlay: one outline per box in its own color and dash
 * pattern, nothing else. Expects output-pixel rects; `null` entries are
 * skipped.
 *
 * `padding` is the per-side margin the overlay canvas already extends beyond
 * the raster (see `overlayLayout`), so rects are shifted by its top/left.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width raster width in pixels
 * @param {number} height raster height in pixels
 * @param {{ rect: RectF | null, color: string, dash: number[] }[]} boxes
 * @param {{ top: number, right: number, bottom: number, left: number }} padding
 */
export function drawBoxOverlay(
  ctx,
  width,
  height,
  boxes,
  padding = { top: 0, right: 0, bottom: 0, left: 0 },
) {
  ctx.clearRect(
    0,
    0,
    width + padding.left + padding.right,
    height + padding.top + padding.bottom,
  );
  const lineWidth = boxLineWidth(width, height);
  ctx.save();
  ctx.lineWidth = lineWidth;
  for (const { rect, color, dash } of boxes) {
    if (rect === null) continue;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.strokeRect(
      rect.x + padding.left,
      rect.y + padding.top,
      rect.width,
      rect.height,
    );
  }
  ctx.restore();
}

/**
 * Draws the document viewBox inside a non-natural view: 1 px solid magenta,
 * after the boxes, so users can see which part of the canvas was previously
 * clipped. Clipping at the canvas edge is accepted (a custom region may be
 * smaller than the document window).
 * @param {CanvasRenderingContext2D} ctx
 * @param {RectF} rect mapped viewBox rect in output pixels
 * @param {{ top: number, right: number, bottom: number, left: number }} padding
 */
export function drawViewBoxOutline(ctx, rect, padding) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = VIEWBOX_COLOR;
  ctx.setLineDash([]);
  ctx.strokeRect(
    rect.x + padding.left,
    rect.y + padding.top,
    rect.width,
    rect.height,
  );
  ctx.restore();
}
