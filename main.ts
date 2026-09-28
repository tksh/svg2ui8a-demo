// svg2ui8a-demo server (Deno-first).
//
// Imports the library straight from JSR.io and renders SVG sources to raw
// RGBA on the server. The browser draws the returned pixels onto a <canvas> —
// no PNG encoder, no client-side Wasm.
import { PhotonImage } from "@denext/photon";
import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";
import { svg2rgba } from "@tksh/svg2ui8a/svg2rgba";
import { svg2usvg } from "@tksh/svg2ui8a/svg2usvg";
import {
  buildShapeSvg,
  escapeAttr,
  genericMeta,
  OGP_HEIGHT,
  OGP_WIDTH,
  parseShapeParams,
  shapeMeta,
} from "./og.ts";
import { fitRegion, parseFit, parseRegion, type RectF } from "./region.ts";

const ROOT = new URL("./public/", import.meta.url);
const SVG_PATH = new URL("./public/ghostscript_tiger.svg", import.meta.url);
const SVG_TEXT = await Deno.readTextFile(SVG_PATH);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  // Block path traversal: only serve flat files under ./public/.
  if (rel.includes("/") || rel.includes("\\") || rel === "") {
    return new Response("Not found", { status: 404 });
  }
  let file: Uint8Array;
  try {
    file = await Deno.readFile(new URL(rel, ROOT));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const dot = rel.lastIndexOf(".");
  const ext = dot >= 0 ? rel.slice(dot) : "";
  return new Response(
    file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer,
    {
      headers: {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      },
    },
  );
}

function parseSizeParam(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 4096) return NaN;
  return n;
}

// `alphaMode` maps straight onto Svg2RgbaOptions.alphaMode; omitted keeps the
// library default ("straight"). Everything else is a 400.
function parseAlphaModeParam(
  value: unknown,
): "straight" | "premultiplied" | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value !== "straight" && value !== "premultiplied") {
    throw new Error(
      'alphaMode must be "straight" or "premultiplied" when given',
    );
  }
  return value;
}

// Max SVG body accepted via POST (plain-text XML, ~1MB is generous).
const MAX_SVG_LENGTH = 1_000_000;

// Reads an optional JSON body `{ svg?, width?, height? }` from a POST
// request. GET requests (and POSTs without a JSON body) yield `{}`,
// in which case callers fall back to query params / defaults.
async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== "POST") return {};
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function resolveSvg(
  body: Record<string, unknown>,
  querySvg: string | null,
): string {
  if (body.svg === undefined) {
    // No POST body svg: fall back to `?svg=` (base64-encoded SVG), then to
    // the bundled sample. An empty query value behaves as "not given".
    if (querySvg === null || querySvg === "") return SVG_TEXT;
    const svg = decodeQuerySvg(querySvg);
    if (svg.length === 0) {
      throw new Error("svg must be a non-empty string");
    }
    if (svg.length > MAX_SVG_LENGTH) {
      throw new Error(`svg must be at most ${MAX_SVG_LENGTH} characters`);
    }
    return svg;
  }
  if (typeof body.svg !== "string" || body.svg.length === 0) {
    throw new Error("svg must be a non-empty string");
  }
  if (body.svg.length > MAX_SVG_LENGTH) {
    throw new Error(`svg must be at most ${MAX_SVG_LENGTH} characters`);
  }
  return body.svg;
}

// Decodes a `?svg=` query value: base64url-encoded SVG (RFC 4648 §5),
// via `decodeBase64Url` from `jsr:@std/encoding`. Base64url is URL-safe
// (`-` and `_` instead of `+` and `/`), so values can be embedded in URLs
// raw. Anything else (standard-base64 characters, garbage) is a 400.
function decodeQuerySvg(value: string): string {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(value);
  } catch {
    throw new Error("svg query param must be valid base64url-encoded SVG");
  }
  return new TextDecoder().decode(bytes);
}

// Shared input for the render-family endpoints: POST JSON body values win,
// GET query params fill the gaps, and the bundled sample is the default SVG.
// Throws on invalid input (callers map this to a 400).
interface RenderInput {
  svg: string;
  width: number | undefined;
  height: number | undefined;
  alphaMode: "straight" | "premultiplied" | undefined;
  region: RectF | undefined;
  fit: boolean;
}

async function resolveRenderInput(req: Request): Promise<RenderInput> {
  const url = new URL(req.url);
  const body = await readJsonBody(req);
  const svg = resolveSvg(body, url.searchParams.get("svg"));
  const width = parseSizeParam(body.width ?? url.searchParams.get("width"));
  const height = parseSizeParam(
    body.height ?? url.searchParams.get("height"),
  );
  if (Number.isNaN(width) || Number.isNaN(height)) {
    throw new Error("width/height must be integers in 1..4096 when given");
  }
  const alphaMode = parseAlphaModeParam(
    body.alphaMode ?? url.searchParams.get("alphaMode"),
  );
  // An explicit region wins over fit=bounds; both are optional.
  const region = parseRegion(body, url.searchParams);
  const fit = region === undefined && parseFit(body, url.searchParams);
  return { svg, width, height, alphaMode, region, fit };
}

// Applies fit=bounds by probing the boxes: they are independent of the output
// size, so a 1x1 render (4 bytes) is enough to compute the window.
async function resolveRenderRegion(
  input: RenderInput,
): Promise<RectF | undefined> {
  if (input.region !== undefined || !input.fit) return input.region;
  const probe = await svg2rgba(input.svg, { width: 1, height: 1 });
  return fitRegion(probe, probe.naturalWidth, probe.naturalHeight);
}

async function handleRgba(req: Request): Promise<Response> {
  let input: RenderInput;
  try {
    input = await resolveRenderInput(req);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }

  try {
    const region = await resolveRenderRegion(input);
    const result = await svg2rgba(input.svg, {
      width: input.width,
      height: input.height,
      ...(input.alphaMode === undefined ? {} : { alphaMode: input.alphaMode }),
      ...(region === undefined ? {} : { region }),
    });
    return Response.json({
      width: result.width,
      height: result.height,
      naturalWidth: result.naturalWidth,
      naturalHeight: result.naturalHeight,
      alphaMode: result.alphaMode,
      // The window that was actually rasterized, defaulting to the natural
      // canvas, so clients have one mapping input for every render.
      region: region ?? {
        x: 0,
        y: 0,
        width: result.naturalWidth,
        height: result.naturalHeight,
      },
      pixelsBase64: encodeBase64(result.pixels),
      absBoundingBox: result.absBoundingBox,
      absStrokeBoundingBox: result.absStrokeBoundingBox,
      absLayerBoundingBox: result.absLayerBoundingBox,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// Shared body for the encoded-image endpoints (/api/png, /api/webp):
// SVG -> raw RGBA (svg2rgba) -> encoded bytes (photon), served directly so
// the URL is usable e.g. as an og:image. Same inputs as /api/rgba.
async function handleEncoded(
  req: Request,
  encode: (img: PhotonImage) => Uint8Array,
  contentType: string,
): Promise<Response> {
  let input: RenderInput;
  try {
    input = await resolveRenderInput(req);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
  try {
    const region = await resolveRenderRegion(input);
    const result = await svg2rgba(input.svg, {
      width: input.width,
      height: input.height,
      ...(input.alphaMode === undefined ? {} : { alphaMode: input.alphaMode }),
      ...(region === undefined ? {} : { region }),
    });
    using img = new PhotonImage(result.pixels, result.width, result.height);
    const bytes = encode(img);
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "content-type": contentType,
        // Output is a deterministic function of the URL: safe to cache.
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

async function handlePng(req: Request): Promise<Response> {
  return await handleEncoded(req, (img) => img.get_bytes(), "image/png");
}

async function handleWebp(req: Request): Promise<Response> {
  return await handleEncoded(
    req,
    (img) => img.get_bytes_webp(),
    "image/webp",
  );
}

async function handleUsvg(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let svg: string;
  try {
    svg = resolveSvg(await readJsonBody(req), url.searchParams.get("svg"));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
  try {
    // SVG string -> Uint8Array (normalized usvg XML bytes) -> usvg string.
    const bytes: Uint8Array = await svg2usvg(svg);
    const usvg = new TextDecoder().decode(bytes);
    return Response.json({ byteLength: bytes.length, usvg });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// Base URL for absolute og:image URLs: https on Deploy, http for localhost.
function publicBaseUrl(req: Request): string {
  const host = req.headers.get("host") ?? "localhost:8000";
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1")
    ? "http"
    : "https";
  return `${proto}://${host}`;
}

// Dynamic OGP card page. Scrapers don't run JS, so the meta tags are
// rendered into the HTML server-side. Absent/invalid params fall back to a
// generic card (never an error).
function handleOg(req: Request): Response {
  const url = new URL(req.url);
  const spec = parseShapeParams(url.searchParams);
  const meta = spec === null ? genericMeta() : shapeMeta(spec);
  const base = publicBaseUrl(req);
  const rawImageUrl = spec === null
    ? `${base}/api/png?width=${OGP_WIDTH}&height=${OGP_HEIGHT}`
    : `${base}/api/png?svg=${
      encodeBase64Url(buildShapeSvg(spec))
    }&width=${OGP_WIDTH}&height=${OGP_HEIGHT}`;
  const title = escapeAttr(meta.title);
  const description = escapeAttr(meta.description);
  const imageUrl = escapeAttr(rawImageUrl);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="${OGP_WIDTH}" />
    <meta property="og:image:height" content="${OGP_HEIGHT}" />
    <meta property="og:image:type" content="image/png" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${description}</p>
      <img src="${imageUrl}" width="${OGP_WIDTH}" height="${OGP_HEIGHT}" alt="${title}" />
      <p><a href="/">Back to the svg2ui8a demo</a></p>
    </main>
  </body>
</html>
`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);
  if (pathname === "/og" && req.method === "GET") {
    return await handleOg(req);
  }
  if (
    pathname === "/api/rgba" &&
    (req.method === "GET" || req.method === "POST")
  ) {
    return await handleRgba(req);
  }
  if (
    pathname === "/api/usvg" && (req.method === "GET" || req.method === "POST")
  ) {
    return await handleUsvg(req);
  }
  if (
    pathname === "/api/png" && (req.method === "GET" || req.method === "POST")
  ) {
    return await handlePng(req);
  }
  if (
    pathname === "/api/webp" && (req.method === "GET" || req.method === "POST")
  ) {
    return await handleWebp(req);
  }
  if (pathname === "/api/source") {
    return new Response(SVG_TEXT, {
      headers: { "content-type": "image/svg+xml; charset=utf-8" },
    });
  }
  if (req.method !== "GET") return new Response("Not found", { status: 404 });
  return await serveStatic(pathname);
});
