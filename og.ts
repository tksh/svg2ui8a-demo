// Shape-driven SVG builder for dynamic OGP cards (see the /og route).
//
// Only geometric shapes are supported: rect and circle. Text rendering is
// intentionally excluded (svg2ui8a does not support it).

// Fixed OGP canvas size (the standard 1200x630 card).
export const OGP_WIDTH = 1200;
export const OGP_HEIGHT = 630;

const NAMED_FILLS = new Set([
  "black",
  "white",
  "gray",
  "grey",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
]);

const MAX_RECT_W = OGP_WIDTH;
const MAX_RECT_H = OGP_HEIGHT;
const MAX_RADIUS = Math.floor(Math.min(OGP_WIDTH, OGP_HEIGHT) / 2);

export type ShapeSpec =
  | { shape: "rect"; fill: string; w: number; h: number }
  | { shape: "circle"; fill: string; r: number };

function parseFill(value: string | null): string | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (NAMED_FILLS.has(v)) return v;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
  return null;
}

function parseIntParam(
  value: string | null,
  min: number,
  max: number,
): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// Parses shape params from a query string, e.g.
// `?shape=rect&fill=red&w=2&h=2` or `?shape=circle&fill=blue&r=50`.
// Returns null when the params are absent or invalid; callers fall back to
// a generic card (never an error: scrapers prefer a generic card to a 500).
export function parseShapeParams(params: URLSearchParams): ShapeSpec | null {
  const shape = params.get("shape");
  const fill = parseFill(params.get("fill"));
  if (shape === "rect" && fill !== null) {
    const w = parseIntParam(params.get("w"), 1, MAX_RECT_W);
    const h = parseIntParam(params.get("h"), 1, MAX_RECT_H);
    if (w !== null && h !== null) return { shape, fill, w, h };
    return null;
  }
  if (shape === "circle" && fill !== null) {
    const r = parseIntParam(params.get("r"), 1, MAX_RADIUS);
    if (r !== null) return { shape, fill, r };
    return null;
  }
  return null;
}

// Builds a deterministic OGP-canvas SVG with the shape centered.
export function buildShapeSvg(spec: ShapeSpec): string {
  const attrs = spec.shape === "rect"
    ? `x="${(OGP_WIDTH - spec.w) / 2}" y="${
      (OGP_HEIGHT - spec.h) / 2
    }" width="${spec.w}" height="${spec.h}"`
    : `cx="${OGP_WIDTH / 2}" cy="${OGP_HEIGHT / 2}" r="${spec.r}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OGP_WIDTH}" height="${OGP_HEIGHT}" viewBox="0 0 ${OGP_WIDTH} ${OGP_HEIGHT}"><${spec.shape} ${attrs} fill="${spec.fill}"/></svg>`;
}

export interface ShapeMeta {
  title: string;
  description: string;
}

function prettyFill(fill: string): string {
  if (fill.startsWith("#")) return fill.toUpperCase();
  return fill[0].toUpperCase() + fill.slice(1);
}

// Derives og:title / og:description from the validated shape params (the
// source of truth — never parsed back out of SVG text).
export function shapeMeta(spec: ShapeSpec): ShapeMeta {
  if (spec.shape === "rect") {
    return {
      title: `${prettyFill(spec.fill)} filled rect`,
      description: `size: width=${spec.w} height=${spec.h}`,
    };
  }
  return {
    title: `${prettyFill(spec.fill)} filled circle`,
    description: `size: radius=${spec.r}`,
  };
}

// Fallback for absent/invalid params: scrapers get a generic card, never a 500.
export function genericMeta(): ShapeMeta {
  return {
    title: "svg2ui8a demo image",
    description: "Rendered with jsr:@tksh/svg2ui8a",
  };
}

// Escapes a value for use inside a double-quoted HTML attribute.
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
