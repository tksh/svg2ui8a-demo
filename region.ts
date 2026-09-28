// Server-side region parsing and fit math for the render endpoints.
//
// A region selects the canvas window that `svg2rgba` rasterizes (the
// `region?: RectF` option added in library 0.5.0). `fit=bounds` computes that
// window from the bounding boxes the library reports: the layer box (which
// already accounts for strokes and filters), falling back to the stroke box,
// then the fill box, padded so the box outlines stay fully visible.

export interface RectF {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderBoxes {
  absBoundingBox: RectF | null;
  absStrokeBoundingBox: RectF | null;
  absLayerBoundingBox: RectF | null;
}

const INVALID_REGION = "region must be finite numbers with width/height > 0";
const BODY_SHAPE = "region must be an object with x, y, width, height";
const QUERY_SHAPE = "region query requires all of rx, ry, rw, rh";

// Reads one numeric field. Absent values yield `undefined`; values that do
// not parse yield `NaN` so callers can report them as invalid.
function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function isValidRegion(region: RectF): boolean {
  return Number.isFinite(region.x) &&
    Number.isFinite(region.y) &&
    Number.isFinite(region.width) &&
    Number.isFinite(region.height) &&
    region.width > 0 &&
    region.height > 0;
}

// Parses a region from the POST JSON body (`region: {x, y, width, height}`)
// or the GET query (`rx`, `ry`, `rw`, `rh`). The body wins over the query.
// Returns undefined when neither is present; throws on malformed input
// (callers map this to a 400).
export function parseRegion(
  body: Record<string, unknown>,
  params: URLSearchParams,
): RectF | undefined {
  const raw = body.region;
  if (raw !== undefined) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(BODY_SHAPE);
    }
    const fields = raw as Record<string, unknown>;
    const x = toNumber(fields.x);
    const y = toNumber(fields.y);
    const width = toNumber(fields.width);
    const height = toNumber(fields.height);
    if (
      x === undefined || y === undefined || width === undefined ||
      height === undefined
    ) {
      throw new Error(BODY_SHAPE);
    }
    const region = { x, y, width, height };
    if (!isValidRegion(region)) throw new Error(INVALID_REGION);
    return region;
  }

  const values = ["rx", "ry", "rw", "rh"].map((key) => params.get(key));
  if (values.every((value) => value === null)) return undefined;
  if (values.some((value) => value === null)) throw new Error(QUERY_SHAPE);
  const [x, y, width, height] = values.map((value) => toNumber(value));
  if (
    x === undefined || y === undefined || width === undefined ||
    height === undefined
  ) {
    throw new Error(QUERY_SHAPE);
  }
  const region = { x, y, width, height };
  if (!isValidRegion(region)) throw new Error(INVALID_REGION);
  return region;
}

// Parses the `fit` selector (POST body or query). Only "bounds" is defined;
// absent or empty means "not requested".
export function parseFit(
  body: Record<string, unknown>,
  params: URLSearchParams,
): boolean {
  const raw = body.fit ?? params.get("fit");
  if (raw === undefined || raw === null || raw === "") return false;
  if (raw !== "bounds") throw new Error('fit must be "bounds" when given');
  return true;
}

// Fit padding in canvas units: `max(1, 1% of the longer side)`.
export function fitPadding(region: RectF): number {
  return Math.max(1, 0.01 * Math.max(region.width, region.height));
}

function positive(box: RectF | null): RectF | null {
  return box !== null && box.width > 0 && box.height > 0 ? box : null;
}

// The fit window: layer box, then stroke box, then fill box, padded by
// `fitPadding`. A document with no painted area keeps the natural canvas
// (the layer box is a `0,0,1,1` placeholder in that case, not real content).
export function fitRegion(
  boxes: RenderBoxes,
  naturalWidth: number,
  naturalHeight: number,
): RectF {
  const natural = { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
  const fill = positive(boxes.absBoundingBox);
  const stroke = positive(boxes.absStrokeBoundingBox);
  if (fill === null && stroke === null) return natural;

  const base = positive(boxes.absLayerBoundingBox) ?? stroke ?? fill;
  if (base === null) return natural;
  const pad = fitPadding(base);
  return {
    x: base.x - pad,
    y: base.y - pad,
    width: base.width + 2 * pad,
    height: base.height + 2 * pad,
  };
}
