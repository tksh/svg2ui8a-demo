// svg2ui8a-demo server (Deno-first).
//
// Imports the library straight from JSR.io and renders SVG sources to raw
// RGBA on the server. The browser draws the returned pixels onto a <canvas> —
// no PNG encoder, no client-side Wasm.
import { PhotonImage } from "@denext/photon";
import { decodeBase64Url } from "@std/encoding/base64url";
import { svg2rgba } from "@tksh/svg2ui8a/svg2rgba";
import { svg2usvg } from "@tksh/svg2ui8a/svg2usvg";

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
async function resolveRenderInput(
  req: Request,
): Promise<
  { svg: string; width: number | undefined; height: number | undefined }
> {
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
  return { svg, width, height };
}

async function handleRgba(req: Request): Promise<Response> {
  let input: {
    svg: string;
    width: number | undefined;
    height: number | undefined;
  };
  try {
    input = await resolveRenderInput(req);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }

  try {
    const result = await svg2rgba(input.svg, {
      width: input.width,
      height: input.height,
    });
    return Response.json({
      width: result.width,
      height: result.height,
      alphaMode: result.alphaMode,
      pixelsBase64: encodeBase64(result.pixels),
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
  let input: {
    svg: string;
    width: number | undefined;
    height: number | undefined;
  };
  try {
    input = await resolveRenderInput(req);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
  try {
    const result = await svg2rgba(input.svg, {
      width: input.width,
      height: input.height,
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

Deno.serve(async (req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);
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
