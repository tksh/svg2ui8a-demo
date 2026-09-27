// Pure helpers for the bounding-box overlay in the demo UI.
//
// svg2ui8a 0.4.0 exposes three usvg boxes on every RgbaResult:
// `absBoundingBox`, `absStrokeBoundingBox`, and `absLayerBoundingBox`. They are
// in the SVG's natural canvas coordinates ("userSpaceOnUse"), while the
// rendered canvas holds `width` x `height` output pixels, so mapping is a
// per-axis scale that is non-uniform when both output sizes are requested.

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} RectF
 */

// One entry per RgbaResult box, in drawing order. Pure red/green/blue: each
// color uses one 255 channel, so they are maximally saturated. The dash
// patterns keep the outlines distinguishable without relying on color alone.
export const BOXES = [
  {
    key: "absBoundingBox",
    label: "absBoundingBox",
    color: "#ff0000",
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

/**
 * Maps a box from natural SVG canvas coordinates to output pixels.
 * @param {RectF | null} rect
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} width
 * @param {number} height
 * @returns {RectF | null}
 */
export function toPixelRect(rect, naturalWidth, naturalHeight, width, height) {
  if (rect === null) return null;
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const scaleX = width / naturalWidth;
  const scaleY = height / naturalHeight;
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
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
 * True when the box sticks out of the rendered canvas, i.e. the image alone
 * cannot show it fully.
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
 * Overlay geometry for a `width` x `height` raster: the padding (half the
 * outline line width), the overlay bitmap size, and the overlay's CSS box in
 * percent of the raster box. The padding lets an outline that lies exactly on
 * the raster boundary be drawn at full width instead of being clipped in half;
 * the percentages keep the two canvases aligned at any display scale.
 * @param {number} width raster width in pixels
 * @param {number} height raster height in pixels
 * @returns {{
 *   padding: number,
 *   bitmapWidth: number,
 *   bitmapHeight: number,
 *   css: { left: number, top: number, width: number, height: number },
 * }}
 */
export function overlayLayout(width, height) {
  const padding = boxLineWidth(width, height) / 2;
  return {
    padding,
    bitmapWidth: width + 2 * padding,
    bitmapHeight: height + 2 * padding,
    css: {
      left: (-padding / width) * 100,
      top: (-padding / height) * 100,
      width: ((width + 2 * padding) / width) * 100,
      height: ((height + 2 * padding) / height) * 100,
    },
  };
}

/**
 * Draws the box overlay: one outline per box in its own color and dash
 * pattern, nothing else. Expects output-pixel rects; `null` entries are
 * skipped.
 *
 * `padding` is the margin the overlay canvas already extends beyond the raster
 * on every side (see `overlayLayout`), so rects are shifted by it; `width` and
 * `height` stay the raster size.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width raster width in pixels
 * @param {number} height raster height in pixels
 * @param {{ rect: RectF | null, color: string, dash: number[] }[]} boxes
 * @param {number} padding
 */
export function drawBoxOverlay(ctx, width, height, boxes, padding = 0) {
  ctx.clearRect(0, 0, width + 2 * padding, height + 2 * padding);
  const lineWidth = boxLineWidth(width, height);
  ctx.save();
  ctx.lineWidth = lineWidth;
  for (const { rect, color, dash } of boxes) {
    if (rect === null) continue;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.strokeRect(
      rect.x + padding,
      rect.y + padding,
      rect.width,
      rect.height,
    );
  }
  ctx.restore();
}
