// svg2ui8a-demo server (Deno-first).
//
// Imports the library straight from JSR.io and renders the bundled
// `public/artwork.svg` to raw RGBA on the server. The browser draws the
// returned pixels onto a <canvas> — no PNG encoder, no client-side Wasm.
import { svg2rgba } from "@tksh/svg2ui8a/svg2rgba";

const ROOT = new URL("./public/", import.meta.url);
const SVG_PATH = new URL("./public/artwork.svg", import.meta.url);
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

function parseSizeParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 4096) return NaN;
  return n;
}

async function handleRender(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const width = parseSizeParam(url.searchParams.get("width"));
  const height = parseSizeParam(url.searchParams.get("height"));
  if (Number.isNaN(width) || Number.isNaN(height)) {
    return Response.json(
      { error: "width/height must be integers in 1..4096 when given" },
      { status: 400 },
    );
  }

  try {
    const result = await svg2rgba(SVG_TEXT, { width, height });
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

Deno.serve(async (req: Request): Promise<Response> => {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/render") return await handleRender(req);
  if (pathname === "/api/source") {
    return new Response(SVG_TEXT, {
      headers: { "content-type": "image/svg+xml; charset=utf-8" },
    });
  }
  if (req.method !== "GET") return new Response("Not found", { status: 404 });
  return await serveStatic(pathname);
});
